import { Component, type ErrorInfo, type ReactNode } from "react";
import { Alert, Button, Stack, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";

interface Props {
  /** What failed, for the message (for example the tab's name). */
  label: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Keeps a rendering error in one tab from blanking the whole app. The connections live in the store rather than in the
 * component tree, so "Try again" re-mounts the tab without losing them.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.label} crashed`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Alert color="red" icon={<IconAlertTriangle size={16} />} title={`${this.props.label} hit an unexpected error`}>
        <Stack gap="xs" align="flex-start">
          <Text size="sm">{this.state.error.message}</Text>
          <Button size="compact-sm" variant="default" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </Stack>
      </Alert>
    );
  }
}
