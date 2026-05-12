-- Add additional cron slots for pressure map generation (auto-retry on transient failures)
SELECT cron.schedule(
  'generate-pressure-map-0530',
  '30 5 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--e38eb7cd-9a65-493a-b3eb-f8b0eb5a851d.lovable.app/api/public/hooks/generate-pressure-map',
    headers := jsonb_build_object('Content-Type','application/json','apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtkb2xub3RqYmhnamllem5tcGdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3Nzg3MjQsImV4cCI6MjA5MzM1NDcyNH0._iVH9b6a0LGocp4i-Ss4-GrHkmpUPdh2anrrXPDoaOg'),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'generate-pressure-map-0730',
  '30 7 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--e38eb7cd-9a65-493a-b3eb-f8b0eb5a851d.lovable.app/api/public/hooks/generate-pressure-map',
    headers := jsonb_build_object('Content-Type','application/json','apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtkb2xub3RqYmhnamllem5tcGdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3Nzg3MjQsImV4cCI6MjA5MzM1NDcyNH0._iVH9b6a0LGocp4i-Ss4-GrHkmpUPdh2anrrXPDoaOg'),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'generate-pressure-map-1030',
  '30 10 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--e38eb7cd-9a65-493a-b3eb-f8b0eb5a851d.lovable.app/api/public/hooks/generate-pressure-map',
    headers := jsonb_build_object('Content-Type','application/json','apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtkb2xub3RqYmhnamllem5tcGdmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3Nzg3MjQsImV4cCI6MjA5MzM1NDcyNH0._iVH9b6a0LGocp4i-Ss4-GrHkmpUPdh2anrrXPDoaOg'),
    body := '{}'::jsonb
  );
  $$
);