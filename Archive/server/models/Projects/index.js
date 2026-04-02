// Relationships

// Each solution can have multiple parameters
Solutions.hasMany(SolutionParameters, {
  foreignKey: "solution_id",
  as: "parameters",
  onDelete: "CASCADE",
});

SolutionParameters.belongsTo(Solutions, {
  foreignKey: "solution_id",
  as: "solution",
});

// Each solution can have multiple themes
Solutions.hasMany(Theme, {
  foreignKey: "solution_id",
  as: "themes",
  onDelete: "CASCADE",
});
Theme.belongsTo(Solutions, { foreignKey: "solution_id", as: "solution" });

// Each theme can have multiple features
Theme.hasMany(Feature, {
  foreignKey: "theme_id",
  as: "features",
  onDelete: "CASCADE",
});
Feature.belongsTo(Theme, { foreignKey: "theme_id", as: "theme" });

// Each feature has one variable. This variable does not have to be unique
Feature.belongsTo(Variable, { foreignKey: "variable_id", as: "variable" });
Variable.hasMany(Feature, { foreignKey: "variable_id", as: "features" });

// Each solution can have multiple weights
Solutions.hasMany(Weight, {
  foreignKey: "solution_id",
  as: "weights",
  onDelete: "CASCADE",
});
Weight.belongsTo(Solutions, { foreignKey: "solution_id", as: "solution" });
// Each weight has one variable. This variable does not have to be unique.
Weight.belongsTo(Variable, { foreignKey: "variable_id", as: "variable" });

// Each solution can have multiple includes
Solutions.hasMany(Includes, {
  foreignKey: "solution_id",
  as: "includes",
  onDelete: "CASCADE",
});
Includes.belongsTo(Solutions, { foreignKey: "solution_id", as: "solution" });
// Each include has one variable. This variable does not have to be unique.
Includes.belongsTo(Variable, { foreignKey: "variable_id", as: "variable" });

// Each solution can have multiple exludes.
Excludes.hasMany(Excludes, {
  foreignKey: "solution_id",
  as: "excludes",
  onDelete: "CASCADE",
});
Excludes.belongsTo(Solutions, { foreignKey: "solution_id", as: "solution" });
// Each exclude has one variable. This variable does not have to be unique.
Excludes.belongsTo(Variable, { foreignKey: "variable_id", as: "variable" });
