import {
  defineComponent,
  h,
  onBeforeUnmount,
  ref,
  shallowRef,
  type PropType,
} from "vue";
import {
  initBugReport,
  type BugReportClient,
  type BugReportClientConfig,
  type BugReportState,
} from "@symbiosika/bugreport-client";

export interface UseBugReportResult {
  /** The underlying client (null until initialised). */
  client: ReturnType<typeof shallowRef<BugReportClient | null>>;
  isSupported: ReturnType<typeof ref<boolean>>;
  state: ReturnType<typeof ref<BugReportState>>;
  start: () => void;
  cancel: () => void;
}

/**
 * Composable around initBugReport. Creates the client on first call and
 * tears it down with the component.
 */
export function useBugReport(config: BugReportClientConfig): UseBugReportResult {
  const client = shallowRef<BugReportClient | null>(null);
  const isSupported = ref<boolean>(false);
  const state = ref<BugReportState>("idle");

  const instance = initBugReport(config);
  client.value = instance;
  isSupported.value = instance.isSupported;
  const unsubscribe = instance.onStateChange((s) => {
    state.value = s;
  });

  onBeforeUnmount(() => {
    unsubscribe();
    instance.destroy();
  });

  return {
    client,
    isSupported,
    state,
    start: () => instance.start(),
    cancel: () => instance.cancel(),
  };
}

/**
 * Renders a button that starts a bug report — and renders nothing at all on
 * unsupported platforms (a visible button that fails on click is worse than
 * no button).
 */
export const BugReportButton = defineComponent({
  name: "BugReportButton",
  props: {
    config: {
      type: Object as PropType<BugReportClientConfig>,
      required: true,
    },
    label: { type: String, default: "Fehler melden" },
  },
  setup(props, { slots }) {
    const { isSupported, state, start } = useBugReport(props.config);
    return () => {
      if (!isSupported.value) return null;
      return h(
        "button",
        {
          type: "button",
          class: "bugreport-button",
          disabled: state.value !== "idle",
          onClick: () => start(),
        },
        slots.default ? slots.default() : props.label,
      );
    };
  },
});
