import { Modal, Text } from "@mantine/core";
import { getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { arch, version as OSVersion, type } from "@tauri-apps/plugin-os";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

function AboutModal({
  opened,
  setOpened,
}: {
  opened: boolean;
  setOpened: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<{
    version: string;
    tauri: string;
    os: string;
    architecture: string;
    osVersion: string;
  } | null>(null);

  useEffect(() => {
    async function load() {
      const os = await type();
      const version = await getVersion();
      const tauri = await getTauriVersion();
      const architecture = await arch();
      const osVersion = await OSVersion();
      setInfo({ version, tauri, os, architecture, osVersion });
    }
    load();
  }, []);
  return (
    <Modal centered opened={opened} onClose={() => setOpened(false)} title="cn-croissant">
      <Text>{t("About.Description")}</Text>
      <Text size="sm" c="dimmed">
        {t("About.BasedOn")}
      </Text>
      <br />
      <Text>
        {t("Common.Version")}: {info?.version}
      </Text>
      <Text>
        {t("About.TauriVersion")}: {info?.tauri}
      </Text>
      <Text>
        {t("About.OS")}: {info?.os} {info?.architecture} {info?.osVersion}
      </Text>
    </Modal>
  );
}

export default AboutModal;
