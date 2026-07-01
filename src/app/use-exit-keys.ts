import { useApp, useInput } from "ink";

type UseExitKeysOptions = {
  readonly isQuitKeyEnabled?: boolean;
  readonly onEscape?: () => void;
};

export function useExitKeys({
  isQuitKeyEnabled = true,
  onEscape,
}: UseExitKeysOptions = {}): void {
  const { exit } = useApp();

  useInput((input, key) => {
    if ((isQuitKeyEnabled && input === "q") || (key.ctrl && input === "c")) {
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
