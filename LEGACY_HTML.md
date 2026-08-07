# Legacy static HTML (rollback only)

The Next.js app in `/web` is the primary frontend. These HTML files and
Jinja templates under `templates/` remain for local rollback against Flask
alone (`python server.py` serving static pages).

Do not ship new UI features here. When Next is confirmed in production,
delete this folder's HTML counterparts and stop Flask from serving page
routes (`/`, `/app`, `/admin`, etc.), leaving only `/api/*`.
