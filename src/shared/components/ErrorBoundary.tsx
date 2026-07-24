import React, { Component, ErrorInfo, ReactNode } from 'react';
import GenericErrorView from './GenericErrorView';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/app';
  };

  public render() {
    if (this.state.hasError) {
      return (
        <GenericErrorView 
          error={this.state.error}
          errorCode="ERR_CODE: UNCAUGHT_REACT_EXCEPTION"
          onReset={this.handleReset}
        />
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
