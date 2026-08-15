import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".worktrees/**",
      ".agent/**",
      ".runtime/**",
      ".next/**",
      ".next-golden/**",
      ".next-security/**",
      ".next-verify/**",
      ".runtime/**",
      ".stryker-tmp/**",
      "artifacts/browser-security/**",
      "artifacts/golden-journey/**",
      "out/**",
      "build/**",
      "coverage/**",
      "next-env.d.ts",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-console": "error",
      "no-restricted-globals": [
        "error",
        { name: "alert", message: "Use the global localized toast or an inline error view." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "window", property: "alert", message: "Use the global localized toast or an inline error view." },
        { object: "globalThis", property: "alert", message: "Use the global localized toast or an inline error view." },
      ],
    },
  },
  {
    // 唯一 no-console 豁免面：
    // - logging/core.ts、logging/file-writer.ts：stdout 权威日志流的最终写出点；
    // - storage/init.ts：独立 bootstrap 进程，logger 就绪前运行；
    // - scripts/**：运维/治理脚本整体豁免，脚本输出即产品。
    files: [
      "src/lib/logging/core.ts",
      "src/lib/logging/file-writer.ts",
      "src/lib/storage/init.ts",
      "scripts/**",
    ],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/ui/icons/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "lucide-react",
              message: "Import icons through '@/components/ui/icons' only.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='svg']",
          message:
            "Use AppIcon or icons module components instead of inline <svg>.",
        },
      ],
    },
  },
];

export default eslintConfig;
