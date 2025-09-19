import { AuthenticationError } from "apollo-server-express";
import { Users, Files, ProjectLayers, Solutions, SolutionLayers, Projects } from "../models/index.js";
import { signToken } from "../utils/auth.js";

export const resolvers = {
  Query: {
    // query all users
    users: async () => {
      return Users.findAll();
    },

    public_projects: async () => {
      return await Projects.findAll({
        where: { user_group: 'public' },
        include: [
          { model: Users, as: "owner" },
          { model: Files, as: "files" },
          { model: Files, as: "planning_unit" }
        ]
      });
    },

    all_projects: async () => {
      return await Projects.findAll({
        include: [
          { model: Users, as: "owner" },
          { model: Files, as: "files" },
          { model: Files, as: "planning_unit" }
        ]
      });
    },

    // query project by id
    project: async (_, { id }) => {
      return await Projects.findByPk(id, {
        include: [
          { model: Users, as: "owner" },
          { model: Solutions, as: "solutions" },
          { model: Files, as: "files" },
          { model: Files, as: "planning_unit" }
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
          { model: SolutionLayers, as: "themes", include: [{ model: ProjectLayers, as: "project_layer" }] },
          { model: ProjectLayers, as: "weights" },
          { model: ProjectLayers, as: "includes" },
          { model: ProjectLayers, as: "excludes" },
          { model: Users, as: "author" },
          { model: Files, as: "file" },
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
      
      // Validate required fields
      if (!input.userGroup || input.userGroup.trim() === '') {
        throw new Error('User Group is required and cannot be empty');
      }
      
      // Planning unit validation will be done at the frontend level

      
      const newProject = await Projects.create({
        owner_id: input.ownerId,
        title: input.title,
        description: input.description,
        user_group: input.userGroup,
        planning_unit_id: input.planningUnitId || null,
      });
      
      return newProject;
    },

    updateProject: async (parent, { id, planningUnitId }) => {
      const project = await Projects.findByPk(id);
      if (!project) {
        throw new Error('Project not found');
      }
      
      await project.update({ planning_unit_id: planningUnitId });
      
      return await Projects.findByPk(id, {
        include: [
          { model: Users, as: "owner" },
          { model: Files, as: "files" },
          { model: Files, as: "planning_unit" }
        ]
      });
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
        hidden: input.hidden,
        visible: input.visible,
        downloadable: input.downloadable
      })
      return newProjectLayer
    },

    // create a new solution with layers
    addSolution: async (parent, { input }) => {
      console.log(input)
      const newSolution = await Solutions.create({
        project_id: input.projectId,
        author_id: input.authorId,
        title: input.title,
        description: input.description,
        author_name: input.authorName,
        author_email: input.authorEmail,
        user_group: input.userGroup,
        file_id: input.fileId
      });

      // Attach join-table layers
      if (input.weightIds?.length) {
        await newSolution.setWeights(input.weightIds);
      }
      if (input.includeIds?.length) {
        await newSolution.setIncludes(input.includeIds);
      }
      if (input.excludeIds?.length) {
        await newSolution.setExcludes(input.excludeIds);
      }
      console.log(newSolution)

      // Create solution theme layers
      if (input.themes?.length) {
        await Promise.all(
          input.themes.map(theme =>
            SolutionLayers.create({
              solution_id: newSolution.id,
              project_layer_id: theme.projectLayerId,
              goal: theme.goal
            })
          )
        );
      }

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
