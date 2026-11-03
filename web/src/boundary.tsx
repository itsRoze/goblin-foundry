import { Component, type ReactNode } from 'react';

/**
 * Keeps a throw in render below it, where React still logs it. It holds state
 * rather than taking `resetOn` as its `key`, because a key would also remount
 * every healthy view whose address moved, as renaming an App does.
 */
export class RenderBoundary extends Component<{ fallback: ReactNode; resetOn?: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidUpdate(prevProps: { resetOn?: string }, prevState: { failed: boolean }) {
    // `prevState`: a view that threw on the very move that brought it here has had its try
    if (prevState.failed && prevProps.resetOn !== this.props.resetOn) this.setState({ failed: false });
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
