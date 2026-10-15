import React from "react";
import { getWebAppBaseUrl } from "../src/urls.js";
import {
  chromeStoreLagNoticeBody,
  shouldShowChromeStoreLagNotice,
} from "../src/chromeStoreLagNotice.js";
import { getExtensionVersion } from "../src/extensionVersion.js";

export function ChromeStoreLagNotice(): React.ReactElement | null {
  const installed = getExtensionVersion();
  if (!shouldShowChromeStoreLagNotice(installed)) {
    return null;
  }

  const installUrl = `${getWebAppBaseUrl().replace(/\/$/, "")}/extension`;

  return (
    <p className="store-lag-notice" role="note">
      {chromeStoreLagNoticeBody()}{" "}
      <a href={installUrl} target="_blank" rel="noreferrer">
        Install latest build
      </a>
    </p>
  );
}
