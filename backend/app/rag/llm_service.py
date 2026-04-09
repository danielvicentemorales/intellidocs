import os
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage


_FAKE_KEY_PREFIXES = ("sk-fake", "your-openai")


class LLMService:
    """Wrapper around the LLM used for generating answers."""

    def __init__(self, model_name="gpt-4o-mini", temperature=0.7):
        self.model_name = model_name
        self.temperature = temperature
        self._llm = None

    def _get_llm(self):
        if self._llm is None:
            api_key = os.getenv("OPENAI_API_KEY", "")
            if not api_key or any(api_key.startswith(p) for p in _FAKE_KEY_PREFIXES):
                raise ValueError(
                    "OPENAI_API_KEY not configured. "
                    "Get your key at https://platform.openai.com/api-keys"
                )
            self._llm = ChatOpenAI(
                model=self.model_name,
                temperature=self.temperature,
                api_key=api_key,
                max_tokens=2000,
            )
        return self._llm

    def generate(self, system_prompt, messages=None, question=None):
        """Send a prompt to the LLM and return the text response.

        Args:
            system_prompt: system-level instructions including context.
            messages: optional conversation history as list of dicts
                      with 'role' and 'content' keys.
            question: the current user question.
        """
        llm = self._get_llm()

        chat_messages = [SystemMessage(content=system_prompt)]

        if messages:
            for msg in messages:
                if msg["role"] == "user":
                    chat_messages.append(HumanMessage(content=msg["content"]))
                else:
                    chat_messages.append(AIMessage(content=msg["content"]))

        if question:
            chat_messages.append(HumanMessage(content=question))

        response = llm.invoke(chat_messages)
        return response.content
