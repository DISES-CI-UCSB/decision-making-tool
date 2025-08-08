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
      return Files.findAll();
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
        include: [{ model: Solutions, as: "solutions" }],
      });
    },
  },

  Mutation: {
    addUser: async (parent, { username, password, type }) => {
      const newUser = await Users.create({ username, password, type });
      return newUser;
    },

    addFile: async (parent, { userId, path }) => {
      const newFile = await Files.create({ user_id: userId, path: path });
      return newFile;
    },

    // create a new solution with layers
    addSolution: async (parent, { input }) => {
      const newSolution = await Solutions.create({
        project_id: input.projectId,
        author_id: input.authorId,
        title: input.title,
        description: input.description,
        author_name: input.authorName,
        author_email: input.authorEmail,
        user_group: input.userGroup,
      });

      const newLayers = await Promise.all(
        input.layers.map((l) =>
          Layers.create({ ...l, solution_id: newSolution.id })
        )
      );

      return { newSolution, newLayers };
    },

    addProject: async (parent, { input }) => {
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
