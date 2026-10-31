begin;

with duplicate_titles as (
  select seo_title
  from profiles
  where status = 'published' and nullif(btrim(seo_title), '') is not null
  group by seo_title
  having count(*) > 1
), source as (
  select p.id, p.seo_title, p.introduction::jsonb as details
  from profiles p
  join duplicate_titles d on d.seo_title = p.seo_title
  where p.status = 'published' and p.source_provider = 'edc-public-catalog'
), fields as (
  select id, seo_title,
    case when coalesce(details->>'serviceArea', '') ~* '^(\?|[-–—]+|n/?a|null|undefined|unknown|未知|不詳|未填|&#[0-9]+;|\{[^}]+\})$' then null else nullif(btrim(details->>'serviceArea'), '') end as area,
    case when coalesce(details->>'height', '') ~* '^(\?|[-–—]+|n/?a|null|undefined|unknown|未知|不詳|未填|&#[0-9]+;|\{[^}]+\})$' then null else nullif(btrim(details->>'height'), '') end as height,
    case when coalesce(details->>'cup', '') ~* '^(\?|[-–—]+|n/?a|null|undefined|unknown|未知|不詳|未填|&#[0-9]+;|\{[^}]+\})$' then null else nullif(btrim(details->>'cup'), '') end as cup,
    case when coalesce(details->>'price', '') ~* '^(\?|[-–—]+|n/?a|null|undefined|unknown|未知|不詳|未填|&#[0-9]+;|\{[^}]+\})$' then null else nullif(btrim(details->>'price'), '') end as price
  from source
), updated_titles as (
  update profiles p
  set seo_title = f.seo_title || '｜' || coalesce(nullif(concat_ws('・',
      f.area,
      case when f.height is not null then f.height || case when f.height ~ '^[0-9]{3}$' then '公分' else '' end end,
      case when f.cup is not null then f.cup || case when f.cup !~ '罩杯$' then '罩杯' else '' end end,
      f.price
    ), ''), '形象資訊'),
    updated_at = now()
  from fields f
  where p.id = f.id
  returning p.id
), duplicate_descriptions as (
  select seo_description
  from profiles
  where status = 'published' and nullif(btrim(seo_description), '') is not null
  group by seo_description
  having count(*) > 1
), description_source as (
  select p.id, p.display_name, c.name as city_name, p.introduction::jsonb as details
  from profiles p
  join profile_cities pc on pc.profile_id = p.id
  join cities c on c.id = pc.city_id
  where p.status = 'published'
    and p.source_provider = 'edc-public-catalog'
    and (
      p.seo_description in (select seo_description from duplicate_descriptions)
      or p.seo_description ~* '(?:&#[0-9]+;|&(?:ndash|mdash);|\{[^}]+\})'
      or p.seo_description ~ '(^|[，、[:space:]])\?([，、。[:space:]]|$)'
    )
), description_fields as (
  select id, display_name, city_name,
    coalesce(nullif(btrim(details->>'serviceMethod'), ''), '成人形象') as service_method,
    case when coalesce(details->>'age', '') ~* '^(\?|[-–—]+|n/?a|null|undefined|unknown|未知|不詳|未填|&#[0-9]+;|\{[^}]+\})$' then null else nullif(btrim(details->>'age'), '') end as age,
    case when coalesce(details->>'height', '') ~* '^(\?|[-–—]+|n/?a|null|undefined|unknown|未知|不詳|未填|&#[0-9]+;|\{[^}]+\})$' then null else nullif(btrim(details->>'height'), '') end as height,
    case when coalesce(details->>'cup', '') ~* '^(\?|[-–—]+|n/?a|null|undefined|unknown|未知|不詳|未填|&#[0-9]+;|\{[^}]+\})$' then null else nullif(btrim(details->>'cup'), '') end as cup,
    case when coalesce(details->>'price', '') ~* '^(\?|[-–—]+|n/?a|null|undefined|unknown|未知|不詳|未填|&#[0-9]+;|\{[^}]+\})$' then null else nullif(btrim(details->>'price'), '') end as price
  from description_source
), updated_descriptions as (
  update profiles p
  set seo_description = f.city_name || f.service_method || '資訊｜' || f.display_name ||
      case when nullif(concat_ws('、',
        case when f.age is not null then f.age || case when f.age ~ '^[0-9]{2}$' then '歲' else '' end end,
        case when f.height is not null then f.height || case when f.height ~ '^[0-9]{3}$' then '公分' else '' end end,
        case when f.cup is not null then f.cup || case when f.cup !~ '罩杯$' then '罩杯' else '' end end,
        f.price
      ), '') is null then '' else '，' || concat_ws('、',
        case when f.age is not null then f.age || case when f.age ~ '^[0-9]{2}$' then '歲' else '' end end,
        case when f.height is not null then f.height || case when f.height ~ '^[0-9]{3}$' then '公分' else '' end end,
        case when f.cup is not null then f.cup || case when f.cup !~ '罩杯$' then '罩杯' else '' end end,
        f.price
      ) end || '。查看公開照片、服務地區與聯絡前須知。',
      updated_at = now()
  from description_fields f
  where p.id = f.id
  returning p.id
)
select
  (select count(*) from updated_titles) as updated_titles,
  (select count(*) from updated_descriptions) as updated_descriptions;

commit;

