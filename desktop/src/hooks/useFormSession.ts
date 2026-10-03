import { useEffect, useState } from 'react';
import { bridge, extractDocumentFacts, hasElectronBridge } from '../lib/bridge';
import type {
  AgentEventPayload,
  ClarificationPromptPayload,
  DocumentRecord,
  ExtractedFact,
  WorkflowState,
} from '../types/autofiller';

export function useFormSession() {
  const [state, setState] = useState<WorkflowState>('IDLE');
  const [documentName, setDocumentName] = useState<string>('');
  const [documentPath, setDocumentPath] = useState<string>('');
  const [documentSize, setDocumentSize] = useState<number>(0);
  const [facts, setFacts] = useState<ExtractedFact[]>([]);
  const [targetUrl, setTargetUrl] = useState<string>('http://127.0.0.1:8000/mock_school_form.html');
  const [instruction, setInstruction] = useState<string>(
    'Fill out the form using the extracted document facts.'
  );
  const [events, setEvents] = useState<AgentEventPayload[]>([]);
  const [clarificationPrompt, setClarificationPrompt] = useState<ClarificationPromptPayload | null>(
    null
  );
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState<boolean>(false);

  useEffect(() => {
    const unsubEvents = bridge.onAgentEvent((evt: AgentEventPayload) => {
      setEvents((prev) => [...prev, evt]);
      if (evt.type === 'TOOL_FAILED' && evt.description) {
        setInlineError(evt.description);
      }
      if (evt.metadata?.facts && Array.isArray(evt.metadata.facts) && evt.metadata.facts.length > 0) {
        setFacts(evt.metadata.facts as ExtractedFact[]);
      }
    });

    const unsubClarify = bridge.onClarificationRequest((prompt: ClarificationPromptPayload) => {
      setClarificationPrompt(prompt);
    });

    const unsubState = bridge.onStateChange((update) => {
      setState(update.state);
      if (update.state !== 'CLARIFICATION_REQUIRED') {
        setClarificationPrompt(null);
      }
    });

    return () => {
      unsubEvents();
      unsubClarify();
      unsubState();
    };
  }, []);

  const handleSelectDocument = async () => {
    setInlineError(null);
    if (!hasElectronBridge) {
      setInlineError('Desktop bridge unavailable');
      return;
    }
    try {
      const result = await bridge.selectDocument();
      if (result.error) {
        setInlineError(result.error);
        return;
      }
      if (!result.canceled && result.filePath) {
        setDocumentPath(result.filePath);
        setDocumentName(result.fileName || 'selected_document.pdf');
        setDocumentSize(result.fileSize || 0);
        setIsExtracting(true);

        const { facts: extracted, error } = await extractDocumentFacts({
          filePath: result.filePath,
          documentName: result.fileName,
        });
        setIsExtracting(false);

        if (error) {
          setInlineError(error);
          setFacts([]);
        } else {
          setFacts(extracted || []);
        }
      }
    } catch (err: any) {
      setIsExtracting(false);
      setInlineError(err?.message || 'Could not select document');
    }
  };

  const handleStartSession = async () => {
    setInlineError(null);
    if (!hasElectronBridge) {
      setInlineError('Desktop bridge unavailable');
      return;
    }
    setEvents([
      {
        eventId: `evt_${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'STATE_CHANGED',
        description: 'Initiating AutoFiller AI form automation session...',
      },
    ]);
    const res = await bridge.startSession({
      documentPath: documentPath || undefined,
      documentName: documentName || undefined,
      facts,
      targetUrl,
    });
    if (!res.success && res.error) {
      setInlineError(res.error);
    }
  };

  const handleAnswerClarification = async (clarificationId: string, answer: string) => {
    setClarificationPrompt(null);
    const res = await bridge.answerClarification(clarificationId, answer);
    if (!res.success) {
      setInlineError('Could not deliver clarification answer.');
    }
  };

  const useDocumentRecord = (doc: DocumentRecord) => {
    setDocumentPath(doc.path);
    setDocumentName(doc.name);
    setDocumentSize(doc.size);
    setFacts(doc.facts || []);
    setInlineError(null);
  };

  const resetSession = () => {
    setState('IDLE');
    setDocumentName('');
    setDocumentPath('');
    setDocumentSize(0);
    setFacts([]);
    setTargetUrl('http://127.0.0.1:8000/mock_school_form.html');
    setInstruction('Fill out the form using the extracted document facts.');
    setEvents([]);
    setClarificationPrompt(null);
    setInlineError(null);
  };

  const isValidUrl = Boolean(
    targetUrl.trim() && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))
  );
  const isDocumentReady = Boolean(facts && facts.length > 0);
  const canStart = isDocumentReady && isValidUrl && state === 'IDLE';

  let disabledReason = '';
  if (!isDocumentReady) disabledReason = 'Process a document first';
  else if (!isValidUrl) disabledReason = 'Enter a valid http(s) URL';
  else if (state !== 'IDLE') disabledReason = 'Session is active';

  return {
    state,
    documentName,
    documentPath,
    documentSize,
    facts,
    targetUrl,
    instruction,
    events,
    clarificationPrompt,
    inlineError,
    isExtracting,
    canStart,
    disabledReason,
    handleSelectDocument,
    handleStartSession,
    handleAnswerClarification,
    setFacts,
    setTargetUrl,
    setInstruction,
    useDocumentRecord,
    resetSession,
    setInlineError,
  };
}
