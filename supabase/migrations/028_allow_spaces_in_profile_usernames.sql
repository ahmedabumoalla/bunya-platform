alter table public.profiles
  drop constraint if exists profiles_username_format;

alter table public.profiles
  add constraint profiles_username_format
  check (
    username is null
    or (
      char_length(username) between 4 and 40
      and username = btrim(username)
      and username !~ '[[:cntrl:]]'
    )
  );
