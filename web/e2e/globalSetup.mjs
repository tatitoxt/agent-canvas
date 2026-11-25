import { startStack } from "./stack.mjs";

export default async function globalSetup() {
  await startStack();
}
