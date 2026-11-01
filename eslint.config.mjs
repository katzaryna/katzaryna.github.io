import js from "@eslint/js";
import globals from "globals";

export default [
  {
    files: ["assets/js/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: globals.browser,
    },
    rules: js.configs.recommended.rules,
  },
];
