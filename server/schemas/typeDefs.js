import { gql } from 'apollo-server-express';


export const typeDefs = gql`
  scalar Date
  scalar Int
  
  type User {
    id: ID!
    username: String!
    password: String!
    type: String!
    files: [File!]!
    solution: [Solution!]!
  }

  type File {
    id: ID!
    name: String!
    description: String!
    uploader: User!
    path: String!
    layer: [Layer!]!
    project: Project!
  }

  type Layer {
    id: ID!
    solutions: Solution
    type: String!
    theme: String!
    file: File!
    name: String!
    legend: String!
    values: [String]!
    color: [String]!
    labels: [String]!
    unit: String!
    provenance: String!
    order: Int!
    visible: Boolean!
    goal: Float!
    downloadable: Boolean!
  }
  
  type Solution {
    id: ID!
    project: Project!
    title: String!
    description: String!
    author: User!
    author_name: String!
    author_email: String!
    userGroup: String!
    layers: [Layer!]!
  }

  type Project {
    id: ID!
    title: String!
    description: String!
    owner: User!
    userGroup: String!
    solutions: [Solution!]!
    files: [File]
  }

  type Auth {
    token: ID
    user: User
  }

  type Query {
    users: [User]!
    files: [File]!
    project_files(projectId: ID!): [File]!
    layers: [Layer]!
    layer(id: ID!): Layer!
    solutions(projectId: ID!): [Solution]!
    projects: [Project]!
    project(id: ID!): Project!
  }

  input LayerInput {
    type: String!
    theme: String!
    filePath: String!       
    name: String!
    legend: String!
    values: [String]!
    color: [String]!
    labels: [String]!
    unit: String!
    provenance: String!
    order: Int!
    visible: Boolean!
    goal: Float!
    downloadable: Boolean!
}

  input SolutionInput {
    projectId: ID! 
    authorId: ID! 
    title: String!
    description: String!
    authorName: String!
    authorEmail: String!
    userGroup: String!
    layers: [LayerInput!]!
  }

  input ProjectInput {
    ownerId: ID!
    title: String!
    description: String!
    userGroup: String!
  }

  type Mutation {

    addUser( username: String!, password: String!, type: String! ): User!
    addFile( name: String!, description: String!, uploaderId: ID!, projectId: ID!, path: String! ): File!
    addSolution(input: SolutionInput!): Solution!
    addProject(input: ProjectInput!): Project!

    userSignOn(username: String!, password: String!): Auth!
  }
`;
