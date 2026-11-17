-- VOID: all browser access is made with a publishable key and the user's JWT.
-- Apply with `supabase db reset` locally or `supabase db push` to a linked project.
begin;

create schema if not exists void_private;
revoke all on schema void_private from public, anon;
grant usage on schema void_private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z][a-z0-9_]{2,23}$'),
  bio text not null default '' check (char_length(bio) <= 160),
  created_at timestamptz not null default clock_timestamp()
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name ~ '^[a-z][a-z0-9-]{2,31}$'),
  visibility text not null check (visibility in ('public', 'private')),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);

create table public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default clock_timestamp(),
  primary key (room_id, user_id)
);
create index room_members_user_id_idx on public.room_members(user_id, room_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.rooms(id) on delete cascade,
  recipient_id uuid references public.profiles(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000 and char_length(btrim(body)) > 0),
  created_at timestamptz not null default clock_timestamp(),
  constraint messages_exactly_one_destination check ((room_id is null) <> (recipient_id is null)),
  constraint messages_no_self_dm check (recipient_id is distinct from sender_id)
);
create index messages_room_history_idx on public.messages(room_id, created_at desc, id desc) where room_id is not null;
create index messages_inbox_idx on public.messages(recipient_id, created_at desc, id desc) where recipient_id is not null;
create index messages_sender_history_idx on public.messages(sender_id, created_at desc);
create index rooms_owner_idx on public.rooms(owner_id);

-- Rate events live outside the exposed API schema and survive room/message
-- deletion, so deleting a room cannot reset a sender's limits.
create table void_private.rate_events (
  actor_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index rate_events_actor_idx on void_private.rate_events(actor_id, action, created_at desc);
revoke all on void_private.rate_events from public, anon, authenticated;
alter table void_private.rate_events enable row level security;

create function void_private.consume_rate(p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception using errcode = '42501', message = 'Sign in first.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  delete from void_private.rate_events where actor_id = v_uid and created_at < clock_timestamp() - interval '1 hour';
  if p_action = 'message' then
    if (select count(*) from void_private.rate_events where actor_id = v_uid and action = p_action and created_at > clock_timestamp() - interval '10 seconds') >= 10
      or (select count(*) from void_private.rate_events where actor_id = v_uid and action = p_action and created_at > clock_timestamp() - interval '1 minute') >= 60 then
      raise exception using errcode = 'P0001', message = 'Message rate limit reached. Wait a moment and try again.';
    end if;
  elsif p_action = 'create_room' then
    if (select count(*) from void_private.rate_events where actor_id = v_uid and action = p_action) >= 10 then
      raise exception using errcode = 'P0001', message = 'Room creation limit reached. Try again later.';
    end if;
  else
    raise exception using errcode = '22023', message = 'Unknown rate limit action.';
  end if;
  insert into void_private.rate_events(actor_id, action) values (v_uid, p_action);
end;
$$;
revoke all on function void_private.consume_rate(text) from public, anon, authenticated;

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.messages enable row level security;

-- These narrowly scoped helpers avoid recursive membership policies. Their
-- search paths are empty, all references qualified, and no caller-supplied user
-- identifier can be used to inspect somebody else's permissions.
create function void_private.is_room_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room_members m
    where m.room_id = p_room_id and m.user_id = (select auth.uid())
  );
$$;
create function void_private.is_room_owner(p_room_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room_id and r.owner_id = (select auth.uid())
  );
$$;
revoke all on function void_private.is_room_member(uuid), void_private.is_room_owner(uuid) from public, anon;
grant execute on function void_private.is_room_member(uuid), void_private.is_room_owner(uuid) to authenticated;

create policy profiles_authenticated_read on public.profiles for select to authenticated using (true);
create policy rooms_visible_read on public.rooms for select to authenticated
  using (visibility = 'public' or void_private.is_room_member(id));
create policy room_members_member_read on public.room_members for select to authenticated
  using (void_private.is_room_member(room_id));
create policy messages_participant_read on public.messages for select to authenticated
  using (
    (room_id is not null and void_private.is_room_member(room_id))
    or (room_id is null and ((select auth.uid()) = sender_id or (select auth.uid()) = recipient_id))
  );
create policy messages_participant_insert on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (
      (room_id is not null and void_private.is_room_member(room_id))
      or (room_id is null and recipient_id is not null and recipient_id <> (select auth.uid()))
    )
  );

-- Revoke defaults explicitly: there is no anonymous directory, public message
-- history, direct membership write, profile takeover, message edit, or timestamp
-- override. Browser mutations use the RPCs below except append-only messages.
revoke all on public.profiles, public.rooms, public.room_members, public.messages from anon, authenticated;
grant select on public.profiles, public.rooms, public.room_members, public.messages to authenticated;
grant insert (sender_id, room_id, recipient_id, body) on public.messages to authenticated;

create function void_private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_username text;
begin
  v_username := lower(btrim(new.raw_user_meta_data ->> 'username'));
  if v_username is null or v_username !~ '^[a-z][a-z0-9_]{2,23}$' then
    raise exception using errcode = '22023', message = 'Username must be 3–24 lowercase letters, numbers or underscores and begin with a letter.';
  end if;
  insert into public.profiles(id, username) values (new.id, v_username);
  return new;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'That username is already in use.';
end;
$$;
revoke all on function void_private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function void_private.handle_new_user();

create function void_private.check_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  -- Application users cannot bypass identity, membership, or limits by calling
  -- PostgREST directly. Even administrative imports must supply a user JWT.
  if v_uid is null or new.sender_id <> v_uid then
    raise exception using errcode = '42501', message = 'Sign in to send messages.';
  end if;
  if new.room_id is not null and not exists (
    select 1 from public.room_members where room_id = new.room_id and user_id = v_uid
  ) then
    raise exception using errcode = '42501', message = 'Join this room before sending messages.';
  end if;
  perform void_private.consume_rate('message');
  new.created_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function void_private.check_message() from public, anon, authenticated;
create trigger before_message_insert before insert on public.messages
  for each row execute function void_private.check_message();

create function public.create_room(p_name text, p_visibility text default 'public')
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_room public.rooms;
begin
  if v_uid is null then raise exception using errcode = '42501', message = 'Sign in first.'; end if;
  if p_name is null or p_name !~ '^[a-z][a-z0-9-]{2,31}$' then
    raise exception using errcode = '22023', message = 'Room names must be 3–32 lowercase letters, numbers or hyphens and begin with a letter.';
  end if;
  if p_visibility is null or p_visibility not in ('public', 'private') then
    raise exception using errcode = '22023', message = 'Visibility must be public or private.';
  end if;
  perform void_private.consume_rate('create_room');
  if (select count(*) from public.rooms where owner_id = v_uid) >= 25 then
    raise exception using errcode = 'P0001', message = 'Room creation limit reached. Try again later.';
  end if;
  insert into public.rooms(name, visibility, owner_id) values (p_name, p_visibility, v_uid) returning * into v_room;
  insert into public.room_members(room_id, user_id) values (v_room.id, v_uid);
  return v_room;
exception when unique_violation then
  -- Identical response for existing public/private names avoids exposing visibility.
  raise exception using errcode = '23505', message = 'That room name is unavailable.';
end;
$$;

create function public.join_room(p_name text)
returns public.rooms language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_room public.rooms;
begin
  if v_uid is null then raise exception using errcode = '42501', message = 'Sign in first.'; end if;
  select * into v_room from public.rooms where name = p_name for key share;
  if not found or (v_room.visibility = 'private' and not exists (
    select 1 from public.room_members where room_id = v_room.id and user_id = v_uid
  )) then
    raise exception using errcode = '42501', message = 'Room unavailable. Private rooms require an invitation.';
  end if;
  insert into public.room_members(room_id, user_id) values (v_room.id, v_uid) on conflict do nothing;
  return v_room;
end;
$$;

create function public.invite_to_room(p_room_id uuid, p_username text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_user_id uuid;
begin
  if v_uid is null or not void_private.is_room_owner(p_room_id) then
    raise exception using errcode = '42501', message = 'Only the room owner can invite members.';
  end if;
  select id into v_user_id from public.profiles where username = p_username;
  if not found then raise exception using errcode = '22023', message = 'User not found.'; end if;
  insert into public.room_members(room_id, user_id) values (p_room_id, v_user_id) on conflict do nothing;
end;
$$;

create function public.leave_room(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Sign in first.'; end if;
  if void_private.is_room_owner(p_room_id) then
    raise exception using errcode = '22023', message = 'Owners must delete their room instead of leaving it.';
  end if;
  delete from public.room_members where room_id = p_room_id and user_id = auth.uid();
end;
$$;

create function public.delete_room(p_room_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not void_private.is_room_owner(p_room_id) then
    raise exception using errcode = '42501', message = 'Only the room owner can delete this room.';
  end if;
  delete from public.rooms where id = p_room_id and owner_id = auth.uid();
end;
$$;

create function public.open_dm(p_username text)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Sign in first.'; end if;
  select * into v_profile from public.profiles where username = p_username;
  if not found then raise exception using errcode = '22023', message = 'User not found.'; end if;
  if v_profile.id = auth.uid() then raise exception using errcode = '22023', message = 'Choose another user to message.'; end if;
  return v_profile;
end;
$$;

create function public.update_profile(p_username text, p_bio text)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare v_profile public.profiles;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Sign in first.'; end if;
  if p_username is null or p_username !~ '^[a-z][a-z0-9_]{2,23}$' then
    raise exception using errcode = '22023', message = 'Username must be 3–24 lowercase letters, numbers or underscores and begin with a letter.';
  end if;
  if p_bio is null or char_length(p_bio) > 160 then
    raise exception using errcode = '22023', message = 'Bio must be at most 160 characters.';
  end if;
  update public.profiles set username = p_username, bio = p_bio where id = auth.uid() returning * into v_profile;
  if not found then raise exception using errcode = '42501', message = 'Profile unavailable.'; end if;
  return v_profile;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'That username is already in use.';
end;
$$;

revoke all on function public.create_room(text,text), public.join_room(text), public.invite_to_room(uuid,text), public.leave_room(uuid), public.delete_room(uuid), public.open_dm(text), public.update_profile(text,text) from public, anon;
grant execute on function public.create_room(text,text), public.join_room(text), public.invite_to_room(uuid,text), public.leave_room(uuid), public.delete_room(uuid), public.open_dm(text), public.update_profile(text,text) to authenticated;

-- Channel authorization is separate from table RLS. The Realtime dashboard's
-- 'Allow public access' must be OFF. Use config.private = true in every client.
create function void_private.can_access_topic(p_topic text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_parts text[]; v_a uuid; v_b uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then return false; end if;
  if p_topic = 'presence:global' then return true; end if;
  if p_topic ~ '^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return void_private.is_room_member(substring(p_topic from 6)::uuid);
  end if;
  if p_topic ~ '^dm:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_parts := string_to_array(p_topic, ':'); v_a := v_parts[2]::uuid; v_b := v_parts[3]::uuid;
    return v_a < v_b and v_uid in (v_a, v_b)
      and exists (select 1 from public.profiles where id = v_a)
      and exists (select 1 from public.profiles where id = v_b);
  end if;
  return false;
end;
$$;
revoke all on function void_private.can_access_topic(text) from public, anon;
grant execute on function void_private.can_access_topic(text) to authenticated;

create policy void_realtime_read on realtime.messages for select to authenticated
  using ((extension = 'presence' or (extension = 'broadcast' and (select realtime.topic()) <> 'presence:global'))
    and void_private.can_access_topic((select realtime.topic())));
create policy void_realtime_write on realtime.messages for insert to authenticated
  with check ((extension = 'presence' or (extension = 'broadcast' and (select realtime.topic()) <> 'presence:global'))
    and void_private.can_access_topic((select realtime.topic())));

-- Postgres Changes always applies the subscriber's SELECT RLS to INSERT rows.
-- No UPDATE/DELETE events are used, since delete events have different RLS
-- semantics. Room deletion is reconciled by normal SELECTs on focus/commands.
alter publication supabase_realtime add table public.messages;

comment on table public.messages is 'Append-only messages, visible only to current room members or DM participants. No anonymous access.';
comment on function public.invite_to_room(uuid,text) is 'Owner grants immediate room access; no invitation link or public token is created.';
commit;
