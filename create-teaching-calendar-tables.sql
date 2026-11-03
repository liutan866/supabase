-- 為教學功能 B / C 建立與 calendar_events 相同結構的兩張新表
create table if not exists public.calendar_events_2 (like public.calendar_events including all);
create table if not exists public.calendar_events_3 (like public.calendar_events including all);

alter table public.calendar_events_2 enable row level security;
alter table public.calendar_events_3 enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'calendar_events_2' and policyname = 'calendar_events_2_select'
  ) then
    create policy calendar_events_2_select on public.calendar_events_2 for select to anon using (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'calendar_events_2' and policyname = 'calendar_events_2_insert'
  ) then
    create policy calendar_events_2_insert on public.calendar_events_2 for insert to anon with check (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'calendar_events_3' and policyname = 'calendar_events_3_select'
  ) then
    create policy calendar_events_3_select on public.calendar_events_3 for select to anon using (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'calendar_events_3' and policyname = 'calendar_events_3_insert'
  ) then
    create policy calendar_events_3_insert on public.calendar_events_3 for insert to anon with check (true);
  end if;
end
$$;
