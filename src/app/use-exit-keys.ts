import { useApp, useInput } from "ink";

type UseExitKeysOptions = {
  readonly onEscape?: () => void;
};

export function useExitKeys({ onEscape }: UseExitKeysOptions = {}): void {
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }

    if (key.escape) {
      if (onEscape !== undefined) {
        onEscape();
        return;
      }

      exit();
    }
  });
}
