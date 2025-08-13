import { AuthenticationError } from "apollo-server-express";
import { Users, Files, Layers, Solutions, Projects } from "../models/index.js";
import { signToken } from "../utils/auth.js";

export const resolvers = {
  Query: {
    // query all users
    users: async () => {
      return Users.findAll();
    },

    // query files
    files: async () => {
      return Files.findAll({
        include: [
          { model: Users, as: 'uploader' },
          { model: Projects, as: 'project' }
        ]
      });
    },

    project_files: async (_, { projectId }) => {
      return Files.findAll({
        where: { project_id: projectId },
        include: [
          { model: Users, as: 'uploader' },
          { model: Projects, as: 'project' }
        ]
      });
  },


    // query layers
    layers: async () => {
      return Layers.findAll();
    },

    // query layer by id, include file
    layer: async (_, { id }) => {
      return Layers.findByPk(id, {
        include: [{ model: Files, as: "file" }],
      });
    },

    // query solutions by project id
    solutions: async (_, { projectId }) => {
      return Solutions.findAll({
        where: { project_id: projectId },
        include: [
          { model: Layers, as: "layers" },
          { model: Users, as: "owner" },
        ],
      });
    },

    // query projects
    projects: async () => {
      return Projects.findAll();
    },

    project: async (_, { id }) => {
      return await Projects.findByPk(id, {
        include: [
          { model: Solutions, as: "solutions" },
          { model: Files, as: "files" }
        ],
      });
    },
  },

  Mutation: {
    addUser: async (parent, { username, password, type }) => {
      const newUser = await Users.create({ username, password, type });
      return newUser;
    },

    addFile: async (parent, { name, description, uploaderId, projectId, path }) => {

      const newFile = await Files.create({ name: name, description: description, uploader_id: uploaderId, project_id: projectId, path: path });
      return newFile;
    },

    // create a new solution with layers
    addSolution: async (parent, { input }) => {
      // Step 1: Create the Solution (without layers yet)
      const newSolution = await Solutions.create({
        project_id: input.projectId,
        author_id: input.authorId,
        title: input.title,
        description: input.description,
        author_name: input.authorName,
        author_email: input.authorEmail,
        user_group: input.userGroup,
      });

      // Step 2: For each layer, find or create the corresponding File record based on file path
      const newLayers = await Promise.all(
        input.layers.map(async (layer) => {
          // Try to find existing File by path
          let fileRecord = await Files.findOne({ where: { path: layer.filePath } });
          if (!fileRecord) {
            // If file not found, create it
            fileRecord = await Files.create({
              user_id: input.authorId,  // assuming author uploads file
              path: layer.filePath,
            });
          }
          
          // Now create the Layer with the file's id
          return Layers.create({
            ...layer,
            fileId: fileRecord.id,
            solution_id: newSolution.id,
          });
        })
      );

      return { ...newSolution.dataValues, layers: newLayers };
    },

    addProject: async (parent, { input }) => {
      console.log(input)
      const newProject = await Projects.create({
        owner_id: input.ownerId,
        title: input.title,
        description: input.description,
        user_group: input.userGroup,
      });
      
      return newProject;
    },

    userSignOn: async (parent, { username, password }) => {
      const user = await Users.findOne({ username });
      if (!user) {
        throw new AuthenticationError("incorrect credentials");
      }

      const correctPw = await user.checkPassword(password);
      if (!correctPw) {
        throw new AuthenticationError("incorrect credentials");
      }

      const token = signToken(user);
      return { token, user };
    },
  },
};
