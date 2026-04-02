# Server - GraphQL API Backend

Node.js Express server with Apollo GraphQL for user authentication, project management, and file storage.

## Architecture

```
server/
├── server.js              # Entry point - Express + Apollo setup
├── config/
│   └── connection.js      # PostgreSQL/Sequelize configuration
├── schemas/
│   ├── typeDefs.js        # GraphQL type definitions
│   ├── resolvers.js       # GraphQL query/mutation resolvers
│   └── index.js           # Schema exports
├── models/
│   ├── Users.js           # User model
│   ├── Projects.js        # Project model
│   ├── Files.js           # File metadata model
│   ├── Solutions.js       # Solution model
│   ├── ProjectLayers.js   # Layer configuration model
│   ├── SolutionLayers.js  # Solution-layer associations
│   └── Projects/          # Nested project models
│       ├── Themes.js
│       ├── Weights.js
│       ├── Includes.js
│       ├── Excludes.js
│       └── ...
├── controllers/
│   └── api/
│       └── userRoutes.js  # REST endpoints (if any)
├── utils/
│   └── auth.js            # JWT authentication middleware
└── seeds/
    └── seedUsers.js       # Database seeding
```

## GraphQL Schema

### Core Types

```graphql
type User {
  id: ID!
  username: String!
  type: String!          # admin, planner, viewer
  files: [File!]!
}

type Project {
  id: ID!
  title: String!
  description: String!
  owner: User!
  user_group: String!
  planning_unit: File
  solutions: [Solution!]
  files: [File]
}

type Solution {
  id: ID!
  project: Project!
  title: String!
  author: User!
  themes: [SolutionLayer!]!
  weights: [ProjectLayer!]
  includes: [ProjectLayer!]
  excludes: [ProjectLayer!]
}

type ProjectLayer {
  id: ID!
  project: Project!
  file: File!
  type: String!          # theme, weight, include, exclude
  theme: String!
  name: String!
  legend: String!
  # ... display configuration
}
```

### Key Queries
- `me` - Current authenticated user
- `project(id)` - Get project by ID
- `projects` - List all accessible projects

### Key Mutations
- `login(username, password)` - Authenticate user
- `addProject(...)` - Create new project
- `addSolution(...)` - Add solution to project

## Environment Variables

```env
DB_HOST=localhost
DB_USER=postgres
DB_PASSWORD=your_password
DB_NAME=decision_tool
DB_PORT=5432
JWT_SECRET=your_jwt_secret
PORT=3001
```

## Running Locally

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Start production server
npm start
```

## Database

Uses PostgreSQL with Sequelize ORM. Tables are auto-created on startup via `sequelize.sync()`.

### Key Tables
| Table | Purpose |
|-------|---------|
| users | User accounts and authentication |
| projects | Project metadata |
| files | Uploaded file references |
| project_layers | Layer configurations per project |
| solutions | Saved prioritization solutions |
| solution_layers | Layer-solution associations with goals |

## API Endpoint

GraphQL endpoint: `http://localhost:3001/graphql`

Access Apollo Studio at this URL for interactive query exploration.

## Docker

```dockerfile
# Build and run
docker build -t decision-tool-server .
docker run -p 3001:3001 --env-file .env decision-tool-server
```

Or use docker-compose from root:
```bash
docker-compose up server
```
