/**
 * StateMachine governing FormPilot workflow lifecycle and allowable transitions.
 */

export type WorkflowState =
  | 'IDLE'
  | 'EXTRACTING_DOC'
  | 'SCANNING_FORM'
  | 'MAPPING_FIELDS'
  | 'CLARIFICATION_REQUIRED'
  | 'FILLING_FORM'
  | 'VERIFYING'
  | 'REVIEW_READY'
  | 'PAUSED'
  | 'USER_TAKEOVER'
  | 'COMPLETED'
  | 'ERROR';

export class StateMachine {
  private currentState: WorkflowState = 'IDLE';
  private previousState: WorkflowState = 'IDLE';
  private listeners: Array<(state: WorkflowState, prevState: WorkflowState) => void> = [];

  constructor(initialState: WorkflowState = 'IDLE') {
    this.currentState = initialState;
  }

  public getState(): WorkflowState {
    return this.currentState;
  }

  public transition(nextState: WorkflowState): void {
    if (this.currentState === nextState) return;

    this.previousState = this.currentState;
    this.currentState = nextState;

    this.listeners.forEach((listener) => {
      try {
        listener(this.currentState, this.previousState);
      } catch (err) {
        console.error('Error in state machine listener:', err);
      }
    });
  }

  public onTransition(listener: (state: WorkflowState, prevState: WorkflowState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public isTerminal(): boolean {
    return this.currentState === 'REVIEW_READY' || this.currentState === 'COMPLETED' || this.currentState === 'ERROR';
  }
}
