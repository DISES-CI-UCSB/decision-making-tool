import Projects from "./Projects.js";
import ProjectLayers from "./ProjectLayers.js";
import Files from "./Files.js"
import Solutions from "./Solutions.js"
import Users from "./Users.js";
import SolutionLayers from "./SolutionLayers.js";

// setup relationships here
Users.hasMany(Files, {
  foreignKey: 'uploader_id',
  as: 'files'
})

Users.hasMany(Solutions, {
  foreignKey: 'author_id',
  as: 'solutions'
})

Files.belongsTo(Users, {
  foreignKey: 'uploader_id',
  as: 'uploader'
})

// Each file can have multiple layers associated with it
Files.hasMany(ProjectLayers, {
  foreignKey: 'file_id',
  as: 'project_layers'
})

Files.belongsTo(Projects, {
  foreignKey: 'project_id',
  as: 'project'
})

// Each project layer has a single file id
ProjectLayers.belongsTo(Files, {
    foreignKey: 'file_id',
    as: 'file'
})

ProjectLayers.belongsTo(Projects, {
  foreignKey: 'project_id',
  as: 'project'
})

ProjectLayers.hasMany(SolutionLayers, {
  foreignKey: "project_layer_id",
  as: "solution_layers"
})

SolutionLayers.belongsTo(ProjectLayers, {
  foreignKey: "project_layer_id",
  as: 'project_layer'
})

// Each layer has a single solution id
SolutionLayers.belongsTo(Solutions, {
  foreignKey: 'solution_id',
  as: 'solution'
})

// Each solution has multiple layers
Solutions.hasMany(SolutionLayers, {
  foreignKey: 'solution_id',
  as: 'layers'
})

// Each solution has a single project
Solutions.belongsTo(Projects, {
  foreignKey: 'project_id',
  as: 'project'
})

// Each solution has a single author
Solutions.belongsTo(Users, {
  foreignKey: 'author_id',
  as: 'author'
})

// Each project has multiple files
Projects.hasMany(Files, {
  foreignKey: "project_id",
  as: "files",
  onDelete: "CASCADE",
});

Projects.hasMany(ProjectLayers, {
  foreignKey: "project_id",
  as: "project_layers",
  onDelete: "CASCADE"
})

// Each project can have multiple solutions
Projects.hasMany(Solutions, {
  foreignKey: "project_id",
  as: "solutions",
  onDelete: "CASCADE",
});

Projects.belongsTo(Users, {
  foreignKey: "owner_id",
  as: "owner"
})


export { Users, Projects, Solutions, Files, ProjectLayers, SolutionLayers };
