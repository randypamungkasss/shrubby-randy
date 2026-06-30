import { useEffect, useRef, useState } from "react";
import { useInput } from "ink";

type UseMenuNavigationOptions = {
  readonly itemCount: number;
  readonly isEnabled?: boolean;
  readonly onChoose?: (index: number) => void;
};

type MenuNavigation = {
  readonly selectedIndex: number;
  readonly setSelectedIndex: (index: number) => void;
};

export function useMenuNavigation({
  isEnabled = true,
  itemCount,
  onChoose,
}: UseMenuNavigationOptions): MenuNavigation {
  const [selectedIndex, setSelectedIndexState] = useState(0);
  const selectedIndexRef = useRef(0);

  const setSelectedIndex = (index: number): void => {
    if (itemCount === 0) {
      selectedIndexRef.current = 0;
      setSelectedIndexState(0);
      return;
    }

    const nextIndex = wrapIndex(index, itemCount);

    selectedIndexRef.current = nextIndex;
    setSelectedIndexState(nextIndex);
  };

  useEffect(() => {
    if (selectedIndexRef.current >= itemCount) {
      setSelectedIndex(0);
    }
  }, [itemCount]);

  useInput((input, key) => {
    if (!isEnabled || itemCount === 0) {
      return;
    }

    if (key.upArrow || input === "k") {
      setSelectedIndex(selectedIndexRef.current - 1);
      return;
    }

    if (key.downArrow || input === "j") {
      setSelectedIndex(selectedIndexRef.current + 1);
      return;
    }

    if (key.return) {
      onChoose?.(selectedIndexRef.current);
      return;
    }

    const numericChoice = Number.parseInt(input, 10);

    if (
      Number.isInteger(numericChoice) &&
      numericChoice >= 1 &&
      numericChoice <= itemCount
    ) {
      const nextIndex = numericChoice - 1;

      setSelectedIndex(nextIndex);
      onChoose?.(nextIndex);
    }
  });

  return { selectedIndex, setSelectedIndex };
}

function wrapIndex(index: number, itemCount: number): number {
  return (index + itemCount) % itemCount;
}
