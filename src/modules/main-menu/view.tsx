import { Box, Text } from "ink";
import { ShrubbyLogo } from "../../components/shrubby-logo.js";
import { useMenuNavigation } from "../../lib/use-menu-navigation.js";
import type { MainMenuItem, MainMenuProps } from "./types.js";

const MENU_ITEMS = [
  {
    id: "create",
    label: "Create worktree",
    description: "Create or reuse a branch in a managed worktree path.",
  },
  {
    id: "list",
    label: "List worktrees",
    description: "Inspect current, linked, clean, and dirty worktrees.",
  },
  {
    id: "refresh",
    label: "Refresh",
    description: "Reload repository and worktree state.",
  },
] as const satisfies readonly MainMenuItem[];

export function MainMenu({
  context,
  onChoose,
  statusMessage,
}: MainMenuProps) {
  const { selectedIndex } = useMenuNavigation({
    itemCount: MENU_ITEMS.length,
    onChoose: (index) => {
      onChoose(MENU_ITEMS[index]);
    },
  });

  return (
    <Box flexDirection="column" width={62} gap={1}>
      <ShrubbyLogo />

      <Box flexDirection="column">
        <Text dimColor wrap="truncate">
          Project: {context.projectName}
        </Text>
        <Text dimColor wrap="truncate">
          Worktrees: {context.worktreeRoot}
        </Text>
        {statusMessage !== undefined ? (
          <Text color="green" wrap="truncate">
            {statusMessage}
          </Text>
        ) : undefined}
      </Box>

      <Box flexDirection="column">
        {MENU_ITEMS.map((item, index) => {
          const isSelected = selectedIndex === index;

          return (
            <Box key={item.id} flexDirection="column">
              <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
                {isSelected ? "> " : "  "}
                {index + 1}. {item.label}
              </Text>
              <Text dimColor wrap="truncate">
                {"     "}
                {item.description}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
