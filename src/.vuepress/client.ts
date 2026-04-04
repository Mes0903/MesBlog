import { defineClientConfig } from "vuepress/client";

import center_frame from "./components/center-frame.vue";
import center_panel from "./components/center-panel.vue";
import center_frame_row from "./components/center-frame-row.vue";

export default defineClientConfig({
  enhance({ app }) {
    app.component("center-frame", center_frame);
    app.component("center-panel", center_panel);
    app.component("center-frame-row", center_frame_row);
  },
});
