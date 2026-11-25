import { stopStack } from "./stack.mjs";

export default async function globalTeardown() {
  await stopStack();
}
