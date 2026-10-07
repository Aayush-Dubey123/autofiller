import { useEffect, useState } from 'react';
import { bridge, extractDocumentFacts, hasElectronBridge } from '../lib/bridge';
import type {
  AgentEventPayload,
  ClarificationPromptPayload,
  DocumentExtractionStage,
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
  const [extractionStage, setExtractionStage] = useState<DocumentExtractionStage>('idle');
  const [isAnsweringClarification, setIsAnsweringClarification] = useState<boolean>(false);

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
      setIsAnsweringClarification(false);
    });

    const unsubState = bridge.onStateChange((update) => {
      setState(update.state);
      if (update.state !== 'CLARIFICATION_REQUIRED') {
        setClarificationPrompt(null);
        setIsAnsweringClarification(false);
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
        setExtractionStage('uploading');

        await new Promise((r) => setTimeout(r, 200));
        setExtractionStage('reading_document');

        await new Promise((r) => setTimeout(r, 200));
        setExtractionStage('extracting_information');

        const { facts: extracted, error } = await extractDocumentFacts({
          filePath: result.filePath,
          documentName: result.fileName,
        });

        if (error) {
          setExtractionStage('error');
          setInlineError(error);
          setFacts([]);
        } else {
          setExtractionStage('organizing_facts');
          await new Promise((r) => setTimeout(r, 200));
          setFacts(extracted || []);
          setExtractionStage('completed');
        }
        setIsExtracting(false);
      }
    } catch (err: any) {
      setExtractionStage('error');
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

  const handleAnswerClarification = async (
    clarificationId: string,
    answer: string
  ): Promise<boolean> => {
    // Keep clarificationPrompt mounted throughout CLARIFICATION_REQUIRED to prevent modal unmount/flash
    setIsAnsweringClarification(true);
    try {
      const res = await bridge.answerClarification(clarificationId, answer);
      if (!res.success) {
        setInlineError('Could not deliver clarification answer.');
        setIsAnsweringClarification(false);
        return false;
      }
      return true;
    } catch (err: any) {
      setInlineError(err?.message || 'Could not deliver clarification answer.');
      setIsAnsweringClarification(false);
      return false;
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
    setIsAnsweringClarification(false);
    setInlineError(null);
  };

  const stopSession = async () => {
    try {
      await bridge.stopAgent();
    } catch (err) {
      console.warn('Could not stop agent cleanly:', err);
    }
    setState('IDLE');
    setClarificationPrompt(null);
    setIsAnsweringClarification(false);
  };

  // Derive dynamic clarification stepper counts truthfully from session state and events
  const totalFromEvents = (() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (typeof e.metadata?.totalClarifications === 'number') {
        return e.metadata.totalClarifications as number;
      }
      const match = e.description?.match(/(\d+)\s+clarifications?\s+needed/i);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
    return undefined;
  })();

  const answeredClarificationsCount = events.filter(
    (e) => e.tool === 'request_clarification' && e.type === 'TOOL_COMPLETED'
  ).length;

  const totalClarifications =
    clarificationPrompt?.total ??
    totalFromEvents ??
    (clarificationPrompt ? 1 : 0);

  const currentClarificationIndex =
    clarificationPrompt?.currentIndex ??
    Math.min(answeredClarificationsCount + 1, Math.max(totalClarifications, 1));

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
    isAnsweringClarification,
    totalClarifications,
    currentClarificationIndex,
    inlineError,
    isExtracting,
    extractionStage,
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
    stopSession,
    setInlineError,
  };
}
