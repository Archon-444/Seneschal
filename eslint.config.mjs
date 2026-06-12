import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // T1.2 guard: no raw Prisma outside the service layer.
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@prisma/client",
              message: "Routes must call services (src/server/services), never Prisma directly.",
            },
            {
              name: "@/server/db",
              message: "Routes must call services (src/server/services), never Prisma directly.",
            },
          ],
        },
      ],
    },
  },
];

export default config;
