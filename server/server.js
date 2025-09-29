import express, { urlencoded, json} from 'express';
import cors from 'cors';
import { ApolloServer } from 'apollo-server-express';
import { join } from 'path';
import { authMiddleware } from './utils/auth.js'

import { typeDefs, resolvers } from './schemas/index.js';
import { sequelize } from './config/connection.js';

import { seedUsers } from './seeds/seedUsers.js';
const PORT = process.env.PORT || 3001;
const app = express();

// if (process.env.NODE_ENV !== 'production') {
//   createAdminAccount()
// }
// seedWebsite()

// app.use(cors({
//   origin: ["http://localhost:3000" ]
// }))
// app.use(
//   '/graphql',
//   cors({origin: ["http://localhost:3001", "http://localhost:3000", "https://studio.apollographql.com"]})
// )

const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: authMiddleware, 
});

app.use(urlencoded({ extended: true }));
app.use(json());
// app.use('/api', uploadImageRoute)
// app.use('/api', calendarEventsRoute)


// if (process.env.NODE_ENV === 'production') {
//   app.use(express.static(join(__dirname, '../client/build')));
//   app.use(express.static(join(__dirname, 'public')));
// } else {
//   app.use(express.static('public'));
// }

// app.get('*', (req, res) => {
//   res.sendFile(join(__dirname, '../client/build/index.html'));
// });


// Create a new instance of an Apollo server with the GraphQL schema
const startApolloServer = async (typeDefs, resolvers) => {
  try {
    // Connect to PostgreSQL
    await sequelize.authenticate();
    console.log('Database connection established.');

    await sequelize.sync(); 
    console.log("Tables created or updated")
    await seedUsers()

    // Start Apollo server
    await server.start();
    server.applyMiddleware({ 
    app, 
    cors: {
        origin: ["http://localhost:3000", "http://localhost:3001", "https://studio.apollographql.com"],
        credentials: true,
    } 
    });

    app.listen(PORT, () => {
      console.log(`API server running on port ${PORT}`);
      console.log(`GraphQL at http://localhost:${PORT}${server.graphqlPath}`);
    });

  } catch (err) {
    console.error('Failed to start server:', err);
  }
  };
  
// Call the async function to start the server
  startApolloServer(typeDefs, resolvers);