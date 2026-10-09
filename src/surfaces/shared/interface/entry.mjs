import { createInterfaceClient } from './adapter/client.mjs';
import { createInterfacePresentation } from './presentation.mjs';
const presentation = createInterfacePresentation({ document, window, client: createInterfaceClient() });
// Subscribe synchronously; a slow preferences IPC must never delay surface init listeners.
void presentation.mount();
window.addEventListener('pagehide', () => presentation.dispose(), { once: true });
