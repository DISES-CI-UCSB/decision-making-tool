import Users from "../models/Users.js";

const userData = [
  {
    username: "manager_test",
    password: "password123", // will be hashed by beforeCreate hook
    type: "manager",
  },
  {
    username: "planner_bob",
    password: "supersecure1",
    type: "planner",
  },
  {
    username: "planner_amy",
    password: "plannerpass",
    type: "planner",
  },
];

export const seedUsers = async () => {
  await Users.bulkCreate(userData, {
    individualHooks: true, // ensures password hashing runs
    returning: true,
  });
};
