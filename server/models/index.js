import Projects from "./Projects.js";
import Layers from "./Layers.js";
import Files from "./Files.js"
import Solutions from "./Solutions.js"
import Users from "./Users.js";

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
Files.hasMany(Layers, {
  foreignKey: 'file_id',
  as: 'layers'
})

Files.belongsTo(Projects, {
  foreignKey: 'project_id',
  as: 'project'
})

// Each layer has a single file id
Layers.belongsTo(Files, {
    foreignKey: 'file_id',
    as: 'file'
})

// Each layer has a single solution id
Layers.belongsTo(Solutions, {
  foreignKey: 'solution_id',
  as: 'solution'
})

// Each solution has multiple layers
Solutions.hasMany(Layers, {
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


export { Users, Projects, Solutions, Files, Layers };
