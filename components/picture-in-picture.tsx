"use client";

import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useChat } from "@ai-sdk/react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, Maximize2, Minimize2 } from "lucide-react";
import { Response } from "@/components/ai-elements/response";
import { Spinner } from "@/components/ui/spinner";
import { supabase, type Transcript, type Prompt } from "@/lib/supabase";
import { EmptyDPIP } from "@/components/empty";
import { SkeletonAIResponse } from "@/components/skeletons";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import Image from "next/image";

// Extend Window interface for Document PiP
declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow: (options: {
        width: number;
        height: number;
      }) => Promise<Window>;
      window: Window | null;
    };
  }
}

interface Conversation {
  id: string;
  title: string; // Will be the prompt label (e.g., "Goal", "Future Work")
  userPrompt: string;
  aiResponse: string;
  timestamp: number;
}

type PromptButtonState =
  | "idle" // Not generated yet
  | "loading" // Currently generating
  | "complete" // Generated but not active
  | "active" // Generated and currently viewing
  | "disabled"; // Cannot interact

export function PictureInPicture() {
  const pipWindowRef = useRef<Window | null>(null);
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null);
  const [isPiPActive, setIsPiPActive] = useState(false);
  const [isSupported, setIsSupported] = useState(true);
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [userSelectedTab, setUserSelectedTab] = useState(false);

  // Track which prompt is currently generating (null when not generating)
  const [generatingPromptLabel, setGeneratingPromptLabel] = useState<
    string | null
  >(null);

  // Map to store which prompt label was used for each message
  const [promptLabelsMap, setPromptLabelsMap] = useState<Map<string, string>>(
    new Map()
  );

  // Supabase data
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [selectedTranscriptId, setSelectedTranscriptId] = useState<
    string | null
  >(null);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);

  const { messages, sendMessage, error, setMessages, status } = useChat();

  // Derive loading state from status
  const isLoading = status === "submitted" || status === "streaming";

  // Get selected transcript
  const selectedTranscript = transcripts.find(
    (t) => t.id === selectedTranscriptId
  );

  // Reset conversations when transcript changes
  useEffect(() => {
    if (selectedTranscriptId) {
      // Clear all conversation state
      setActiveConversationId(null);
      setPromptLabelsMap(new Map());
      setGeneratingPromptLabel(null);
      setUserSelectedTab(false);
      setMessages([]); // Clear chat messages
    }
  }, [selectedTranscriptId, setMessages]);

  // Store prompt label when a new assistant message appears
  useEffect(() => {
    if (messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];

    // When a new assistant message appears and we have a generating label
    if (
      lastMessage.role === "assistant" &&
      generatingPromptLabel &&
      !promptLabelsMap.has(lastMessage.id)
    ) {
      setPromptLabelsMap((prev) =>
        new Map(prev).set(lastMessage.id, generatingPromptLabel)
      );

      // Clear generating state only when loading is complete
      if (!isLoading) {
        setGeneratingPromptLabel(null);
      }
    }
  }, [messages, generatingPromptLabel, isLoading, promptLabelsMap]);

  // Derive conversations from messages (pure transformation)
  const conversations = useMemo(() => {
    const convos: Conversation[] = [];

    // Helper to extract text content from message parts
    const extractTextContent = (message: (typeof messages)[number]) => {
      return message.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("");
    };

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      if (message.role === "assistant") {
        // Find the corresponding user message (should be right before this)
        const userMessage = messages[i - 1];

        if (userMessage && userMessage.role === "user") {
          const userPrompt = extractTextContent(userMessage);
          const aiResponse = extractTextContent(message);

          // Look up the prompt label for this specific message, or use truncated prompt as fallback
          const storedLabel = promptLabelsMap.get(message.id);
          const title =
            storedLabel ||
            userPrompt.slice(0, 30) + (userPrompt.length > 30 ? "..." : "");

          convos.push({
            id: message.id,
            title: title,
            userPrompt: userPrompt,
            aiResponse: aiResponse,
            timestamp: Date.now(),
          });
        }
      }
    }

    return convos;
  }, [messages, promptLabelsMap]);

  // Create a lookup map: prompt label -> conversation (for O(1) lookups)
  const conversationsByLabel = useMemo(() => {
    const map = new Map<string, Conversation>();
    conversations.forEach((conv) => {
      map.set(conv.title, conv);
    });
    return map;
  }, [conversations]);

  // Auto-select conversation when new ones are added
  useEffect(() => {
    if (conversations.length === 0) return;

    const latestConvId = conversations[conversations.length - 1].id;

    // Auto-select logic:
    if (!activeConversationId) {
      // No conversation selected yet - select the latest
      setActiveConversationId(latestConvId);
    } else if (!userSelectedTab) {
      // User hasn't manually selected a tab - always switch to latest
      setActiveConversationId(latestConvId);
    } else {
      // User manually selected a tab - keep it unless it no longer exists
      const activeStillExists = conversations.find(
        (c) => c.id === activeConversationId
      );
      if (!activeStillExists) {
        setActiveConversationId(latestConvId);
      }
    }
  }, [conversations, activeConversationId, userSelectedTab]);

  // Get active conversation
  const activeConversation = conversations.find(
    (c) => c.id === activeConversationId
  );
  const aiResponseText = activeConversation?.aiResponse || "";

  // Fetch transcripts and prompts from Supabase
  useEffect(() => {
    async function fetchData() {
      setIsLoadingData(true);
      try {
        // Fetch transcripts
        const { data: transcriptsData, error: transcriptsError } =
          await supabase
            .from("transcripts")
            .select("*")
            .order("created_at", { ascending: false });

        if (transcriptsError) throw transcriptsError;
        setTranscripts(transcriptsData || []);

        // Fetch prompts
        const { data: promptsData, error: promptsError } = await supabase
          .from("prompts")
          .select("*")
          .order("order", { ascending: true });

        if (promptsError) throw promptsError;
        setPrompts(promptsData || []);
      } catch (err) {
        console.error("Error fetching data:", err);
      } finally {
        setIsLoadingData(false);
      }
    }

    fetchData();
  }, []);

  // Check if Document Picture-in-Picture is supported
  useEffect(() => {
    if (!("documentPictureInPicture" in window)) {
      setIsSupported(false);
      console.error(
        "Document Picture-in-Picture API is not supported in this browser"
      );
    }
  }, []);

  // Handle prompt button click - smart button: switch to existing or generate new
  const handlePromptClick = useCallback(
    (prompt: Prompt) => {
      if (!selectedTranscript) return;

      // Check if we already have a conversation for this prompt (O(1) lookup)
      const existingConv = conversationsByLabel.get(prompt.label);

      if (existingConv) {
        // Already generated - just switch to it
        setUserSelectedTab(true);
        setActiveConversationId(existingConv.id);
      } else if (!isLoading) {
        // Not generated yet - create new one
        setUserSelectedTab(false); // Reset on new generation
        setGeneratingPromptLabel(prompt.label); // Track which prompt is generating

        // Replace {transcript} placeholder with actual transcript content
        const processedPrompt = prompt.template.replace(
          "{transcript}",
          selectedTranscript.content
        );

        if (process.env.NODE_ENV === "development") {
          console.log("=== SENDING PROMPT TO AI ===");
          console.log("Prompt length:", processedPrompt.length);
          console.log("Transcript length:", selectedTranscript.content.length);
          console.log("Full prompt:", processedPrompt);
          console.log("=== END PROMPT ===");
        }

        sendMessage({ text: processedPrompt });
      }
    },
    [isLoading, selectedTranscript, sendMessage, conversationsByLabel]
  );

  // Helper function to get button state - single source of truth for button states
  const getPromptButtonState = useCallback(
    (prompt: Prompt): PromptButtonState => {
      if (!selectedTranscript) return "disabled";

      const existingConv = conversationsByLabel.get(prompt.label);
      const isThisPromptGenerating = generatingPromptLabel === prompt.label;

      // If this specific prompt is generating, it's in loading state
      if (isThisPromptGenerating && isLoading) return "loading";

      // If another prompt is generating, this button is disabled
      if (isLoading && !isThisPromptGenerating) return "disabled";

      // If conversation exists and is active
      if (existingConv?.id === activeConversationId) return "active";

      // If conversation exists but not active
      if (existingConv) return "complete";

      // Default: not yet generated
      return "idle";
    },
    [
      selectedTranscript,
      conversationsByLabel,
      generatingPromptLabel,
      isLoading,
      activeConversationId,
    ]
  );

  // PiP Content Component (rendered via portal)
  const PiPContent = () => (
    <div className="h-screen w-full flex flex-col bg-accent">
      {/* Conversation area with auto-scroll */}
      <Conversation className="flex-1">
        <ConversationContent className="p-6">
          {!aiResponseText && !isLoading ? (
            <EmptyDPIP />
          ) : !aiResponseText && isLoading ? (
            <SkeletonAIResponse />
          ) : (
            <Response>{aiResponseText}</Response>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Smart prompt buttons - fixed at bottom */}
      <div className="p-4">
        <div className="flex flex-row justify-between items-end gap-4">
          <div className="flex flex-wrap gap-2 border bg-background rounded-full p-2 w-full shadow">
            {prompts.map((prompt) => {
              const buttonState = getPromptButtonState(prompt);

              // Determine button styling based on state
              const stateStyles = {
                idle: "cursor-pointer",
                loading: "border-blue-500 ring-2 ring-blue-500",
                complete:
                  "border-green-500 ring-1 ring-green-500 bg-green-50 text-primary cursor-pointer hover:bg-green-100",
                active:
                  "border-blue-500 ring-2 ring-blue-500 text-primary bg-blue-50 hover:bg-blue-100",
                disabled: "cursor-not-allowed opacity-50",
              };
              return (
                <Button
                  size="sm"
                  key={prompt.id}
                  onClick={() => handlePromptClick(prompt)}
                  disabled={
                    buttonState === "disabled" || buttonState === "loading"
                  }
                  variant="outline"
                  className={`text-muted-foreground rounded-full ${stateStyles[buttonState]}`}
                >
                  {buttonState === "loading" && <Spinner className="size-4" />}
                  {(buttonState === "complete" || buttonState === "active") && (
                    <Check className="size-4" />
                  )}
                  {prompt.label}
                </Button>
              );
            })}
          </div>
          <div className="flex items-end justify-end h-12 w-12 min-w-12 min-h-12">
            <Image
              className="w-full h-full object-cover"
              src="/rhThumb.png"
              alt="NBG AI"
              width={100}
              height={100}
            />
          </div>
        </div>
      </div>
    </div>
  );

  // Open Document Picture-in-Picture window
  const openPiPWindow = async () => {
    try {
      if (!window.documentPictureInPicture) {
        alert(
          "Document Picture-in-Picture is not supported. Please use Chrome 116+"
        );
        return;
      }

      const pipWindow = await window.documentPictureInPicture.requestWindow({
        width: 600,
        height: 600,
      });

      pipWindowRef.current = pipWindow;

      // Copy stylesheets to PiP window
      [...document.styleSheets].forEach((styleSheet) => {
        try {
          const cssRules = [...styleSheet.cssRules]
            .map((rule) => rule.cssText)
            .join("");
          const style = pipWindow.document.createElement("style");
          style.textContent = cssRules;
          pipWindow.document.head.appendChild(style);
        } catch {
          // External stylesheets might fail due to CORS
          const link = pipWindow.document.createElement("link");
          link.rel = "stylesheet";
          link.type = styleSheet.type;
          link.href = styleSheet.href || "";
          pipWindow.document.head.appendChild(link);
        }
      });

      // Create container for React portal
      const container = pipWindow.document.createElement("div");
      container.id = "pip-content";
      pipWindow.document.body.appendChild(container);
      setPipContainer(container);

      // Handle window close
      pipWindow.addEventListener("pagehide", () => {
        setPipContainer(null);
        pipWindowRef.current = null;
        setIsPiPActive(false);
      });

      setIsPiPActive(true);
    } catch (error) {
      console.error("Error opening PiP window:", error);
    }
  };

  // Close PiP window
  const closePiPWindow = () => {
    if (pipWindowRef.current) {
      pipWindowRef.current.close();
      setPipContainer(null);
      pipWindowRef.current = null;
      setIsPiPActive(false);
    }
  };

  // Toggle PiP
  const togglePiP = async () => {
    if (isPiPActive) {
      closePiPWindow();
    } else {
      await openPiPWindow();
    }
  };

  if (!isSupported) {
    return (
      <div className="p-4 bg-destructive/10 text-destructive rounded-lg">
        <p className="font-medium">
          Document Picture-in-Picture is not supported in your browser.
        </p>
        <p className="text-sm mt-1">Please use Chrome 116 or later.</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto space-y-4 items-start">
      {/* Error Display */}
      {error && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-lg">
          <p className="font-semibold">Error:</p>
          <p className="text-sm">{error.message}</p>
        </div>
      )}

      {/* Transcript Selector */}
      <Card className="w-full mx-auto shadow-none">
        <CardHeader>
          <CardTitle>
            Select Transcript {isLoadingData && "(Loading...)"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <Select
            value={selectedTranscriptId || ""}
            onValueChange={setSelectedTranscriptId}
            disabled={isLoadingData || transcripts.length === 0}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a transcript to analyze..." />
            </SelectTrigger>
            <SelectContent>
              {transcripts.map((transcript) => (
                <SelectItem key={transcript.id} value={transcript.id}>
                  {transcript.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
        <CardFooter>
          <Button
            className="w-full"
            onClick={togglePiP}
            variant={isPiPActive ? "destructive" : "default"}
            disabled={!selectedTranscript}
          >
            {isPiPActive ? (
              <>
                <Minimize2 />
                Close AI PiP Window
              </>
            ) : (
              <>
                <Maximize2 />
                Open AI PiP Window
              </>
            )}
          </Button>
        </CardFooter>
      </Card>

      {/* PiP Control Card */}
      <div className="relative"></div>

      {/* Render PiP content via portal when PiP is active */}
      {pipContainer && createPortal(<PiPContent />, pipContainer)}
    </div>
  );
}
