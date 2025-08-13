import { AuthenticationError } from "apollo-server-express";
import { Users, Files, ProjectLayers, Solutions, SolutionLayers, Projects } from "../models/index.js";
import { signToken } from "../utils/auth.js";

export const resolvers = {
  Query: {
    // query all users
    users: async () => {
      return Users.findAll();
    },

    // query projects
    projects: async () => {
      return Projects.findAll();
    },

    // query project by id
    project: async (_, { id }) => {
      return await Projects.findByPk(id, {
        include: [
          { model: Solutions, as: "solutions" },
          { model: Files, as: "files" }
        ],
      });
    },

    // query all files
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
    projectLayers: async (_, { projectId }) => {
      return ProjectLayers.findAll({
        where: {project_id: projectId},
        include: [
          { model: Files, as: 'file'}
        ]
      });
    },

    // query layer by id, include file
    projectLayer: async (_, { layerId }) => {
      return ProjectLayers.findByPk(layerId, {
        include: [{ model: Files, as: "file" }],
      });
    },

    // query solutions by project id
    solutions: async (_, { projectId }) => {
      return Solutions.findAll({
        where: { project_id: projectId },
        include: [
          { model: SolutionLayers, as: "solution_layers", include: [{ model: ProjectLayers, as: "project_layer" }] },
          { model: Users, as: "author" },
        ],
      });
    },

    solutionLayers: async (_, { solutionId}) => {
      return SolutionLayers.findAll({
        where: { solution_id: solutionId },
        include: [
          { model: ProjectLayers, as: "project_layer"}
        ]
      })
    }

  },

  Mutation: {
    addUser: async (parent, { username, password, type }) => {
      const newUser = await Users.create({ username, password, type });
      return newUser;
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

    addFile: async (parent, { name, description, uploaderId, projectId, path }) => {

      const newFile = await Files.create({ name: name, description: description, uploader_id: uploaderId, project_id: projectId, path: path });
      return newFile;
    },

    addProjectLayer: async(parent, { input }) => {
      const newProjectLayer = await ProjectLayers.create({
        project_id: input.projectId,
        file_id: input.fileId || null,
        type: input.type,
        theme: input.theme,
        name: input.name,
        legend: input.legend,
        values: input.values,
        color: input.color,
        labels: input.labels,
        unit: input.unit,
        provenance: input.provenance,
        order: input.order,
        visible: input.visible,
        downloadable: input.downloadable
      })
      return newProjectLayer
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

      return newSolution;
    },

    addSolutionLayer: async(parent, {input}) => {
      const newSolutionLayer = await SolutionLayers.create({
        solution_id: input.solutionId,
        project_layer_id: input.projectLayerId,
        goal: input.goal
      })
      return newSolutionLayer
    },
    

    userSignOn: async (parent, { username, password }) => {
      const user = await Users.findOne({ where: { username } });
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
