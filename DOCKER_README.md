# Docker Setup for Decision Making Tool

This setup provides a complete containerized environment for the Decision Making Tool, including:
- PostgreSQL database
- Node.js GraphQL server
- R Shiny application
- Nginx reverse proxy
- Persistent volume for uploads

## Quick Start

### 1. Environment Setup

Copy the environment template and configure your settings:
```bash
cp env.example .env
```

Edit `.env` with your configuration:
```bash
# Required: Set a secure database password
DB_PASSWORD=your_secure_password_here

# Required: Set a JWT secret for authentication
JWT_SECRET=your_jwt_secret_key_here

# Optional: Configure Shiny app settings
FORCE_DEFAULT_PROJECTS=false
PROJECT_DIRECTORY=./projects
R_CONFIG_ACTIVE=default

# Optional: Path to Gurobi license file
PATH_TO_GUROBI_LICENSE=/path/to/your/gurobi.lic
```

### 2. Production Deployment

Start all services:
```bash
docker-compose up -d
```

This will start:
- **Database**: PostgreSQL on port 5432
- **GraphQL Server**: Node.js API on port 4000
- **Shiny App**: R Shiny on port 3838
- **Nginx**: Reverse proxy on port 80

Access the application at: http://localhost

### 3. Development Mode

For development with hot reloading:
```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

This mounts your source code into the containers for live development.

## Services

### Database (PostgreSQL)
- **Port**: 5432
- **Database**: decision_tool
- **User**: postgres
- **Password**: Set in `.env` file
- **Volume**: `postgres_data` (persistent)

### GraphQL Server
- **Port**: 4000
- **Endpoint**: http://localhost:4000/graphql
- **Health Check**: http://localhost:4000/graphql
- **Uploads**: Shared volume with Shiny app

### Shiny App
- **Port**: 3838
- **URL**: http://localhost:3838 (direct) or http://localhost (via nginx)
- **Uploads**: Shared volume with server

### Nginx (Production)
- **Port**: 80 (HTTP), 443 (HTTPS)
- **Routes**:
  - `/` → Shiny App
  - `/graphql` → GraphQL Server
  - `/health` → Health check

## Persistent Data

### Uploads Volume
The `uploads_data` volume is shared between the server and Shiny app:
- **Server**: `/app/uploads`
- **Shiny App**: `/app/uploads`
- **Host**: Managed by Docker

To backup uploads:
```bash
docker run --rm -v decision-making-tool_uploads_data:/data -v $(pwd):/backup alpine tar czf /backup/uploads-backup.tar.gz -C /data .
```

To restore uploads:
```bash
docker run --rm -v decision-making-tool_uploads_data:/data -v $(pwd):/backup alpine tar xzf /backup/uploads-backup.tar.gz -C /data
```

### Database Volume
The `postgres_data` volume stores the PostgreSQL database:

To backup database:
```bash
docker-compose exec database pg_dump -U postgres decision_tool > backup.sql
```

To restore database:
```bash
docker-compose exec -T database psql -U postgres decision_tool < backup.sql
```

## Management Commands

### View logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f server
docker-compose logs -f shiny-app
```

### Restart services
```bash
# All services
docker-compose restart

# Specific service
docker-compose restart server
```

### Update and rebuild
```bash
# Pull latest images and rebuild
docker-compose build --no-cache
docker-compose up -d
```

### Clean up
```bash
# Stop and remove containers
docker-compose down

# Remove volumes (WARNING: This deletes all data!)
docker-compose down -v

# Remove images
docker-compose down --rmi all
```

## Troubleshooting

### Check service health
```bash
docker-compose ps
```

### Access container shell
```bash
# Server container
docker-compose exec server sh

# Shiny app container
docker-compose exec shiny-app bash

# Database container
docker-compose exec database psql -U postgres decision_tool
```

### View resource usage
```bash
docker stats
```

### Network connectivity
```bash
# Test GraphQL server from Shiny app
docker-compose exec shiny-app wget -qO- http://server:4000/graphql

# Test database from server
docker-compose exec server nc -zv database 5432
```

## Security Considerations

1. **Change default passwords** in `.env` file
2. **Use HTTPS** in production (configure SSL certificates)
3. **Firewall rules** - only expose necessary ports
4. **Regular updates** - keep base images updated
5. **Backup strategy** - regular backups of volumes

## Production Deployment

For production deployment:

1. **Use HTTPS**: Configure SSL certificates in nginx
2. **Environment variables**: Use Docker secrets or external secret management
3. **Resource limits**: Add resource constraints to services
4. **Monitoring**: Add health checks and monitoring
5. **Backup automation**: Set up automated backups

Example production override:
```yaml
# docker-compose.prod.yml
version: "3.9"
services:
  server:
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M
  shiny-app:
    deploy:
      resources:
        limits:
          memory: 2G
        reservations:
          memory: 1G
```

Deploy with:
```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```
