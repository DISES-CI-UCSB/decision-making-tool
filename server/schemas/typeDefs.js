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
    project_layer: [ProjectLayer!]!
    project: Project!
  }

  type ProjectLayer {
    id: ID!
    project: Project!
    file: File!
    type: String!
    theme: String!
    name: String!
    legend: String!
    values: [String]!
    color: [String]!
    labels: [String]!
    unit: String!
    provenance: String!
    order: Int!
    visible: Boolean!
    downloadable: Boolean!
  }

  type SolutionLayer {
    id: ID!
    solution: Solution!
    project_layer: ProjectLayer!
    goal: Float!
  }
  
  type Solution {
    id: ID!
    project: Project!
    file: File
    title: String!
    description: String!
    author: User!
    author_name: String!
    author_email: String!
    user_group: String!
    themes: [SolutionLayer!]!
    weights: [ProjectLayer!]
    includes: [ProjectLayer!]
    excludes: [ProjectLayer!]
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
    projects(userGroup: String, userType: String): [Project]!
    project(id: ID!): Project!
    files: [File]!
    project_files(projectId: ID!): [File]!
    projectLayers(projectId: ID!): [ProjectLayer]!
    projectLayer(layerId: ID!): ProjectLayer!
    solutions(projectId: ID!): [Solution]!
    solutionLayers(solutionId: ID!): [SolutionLayer]!
  }

  input ProjectInput {
    ownerId: ID!
    title: String!
    description: String!
    userGroup: String!
  }

  input ProjectLayerInput {
    projectId: ID!
    fileId: ID!
    type: String!
    theme: String     
    name: String!
    legend: String
    values: [String]
    color: [String]
    labels: [String]
    unit: String
    provenance: String
    order: Int
    hidden: Boolean
    visible: Boolean
    downloadable: Boolean
  }

  input SolutionInput {
    projectId: ID! 
    authorId: ID! 
    title: String!
    description: String!
    authorName: String!
    authorEmail: String!
    userGroup: String!
    fileId: ID
    weightIds: [ID!]   
    includeIds: [ID!]  
    excludeIds: [ID!]
    themes: [SolutionLayerInput!] 
  }

  
  input SolutionLayerInput {
    projectLayerId: ID!
    goal: Float
  }

  type Mutation {

    addUser( username: String!, password: String!, type: String! ): User!
    addProject(input: ProjectInput!): Project!
    addFile( name: String!, description: String!, uploaderId: ID!, projectId: ID!, path: String! ): File!
    addProjectLayer( input: ProjectLayerInput ): ProjectLayer!
    addSolution(input: SolutionInput!): Solution!
    addSolutionLayer(input: SolutionLayerInput!): SolutionLayer!
    

    userSignOn(username: String!, password: String!): Auth!
  }
`;
