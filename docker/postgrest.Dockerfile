FROM postgrest/postgrest:latest

# PostgREST runs on port 3000 by default; Render maps it via PORT env var or standard port.
EXPOSE 3000
