import { Modal } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useAtom } from "jotai";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { enginesAtom } from "@/state/atoms";
import { detectBuiltinPikafish } from "@/utils/builtinEngine";
import { type LocalEngine } from "@/utils/engines";
import EngineForm from "./EngineForm";

function AddEngine({
  opened,
  setOpened,
}: {
  opened: boolean;
  setOpened: (opened: boolean) => void;
}) {
  const { t } = useTranslation();
  const [allEngines, setEngines] = useAtom(enginesAtom);
  const engines = (allEngines ?? []).filter(
    (engine): engine is LocalEngine => engine.type === "local",
  );

  const form = useForm<LocalEngine>({
    initialValues: {
      type: "local",
      id: crypto.randomUUID(),
      version: "",
      name: "",
      path: "",
      protocol: "uci",
      image: "",
    },

    validate: {
      name: (value) => {
        if (!value) return t("Common.RequireName");
        if (engines.find((engine) => engine.name === value)) return t("Common.NameAlreadyUsed");
      },
      path: (value) => {
        if (!value) return t("Common.RequirePath");
      },
    },
  });

  useEffect(() => {
    if (!opened || form.values.path) return;

    void detectBuiltinPikafish()
      .then((builtin) => {
        form.setValues({ ...builtin, id: crypto.randomUUID() });
      })
      .catch(() => {
        // The local form still supports manually selecting any Xiangqi engine.
      });
  }, [opened]);

  return (
    <Modal
      opened={opened}
      onClose={() => setOpened(false)}
      title={t("Engines.Add.Title")}
      size="lg"
    >
      <EngineForm
        submitLabel={t("Common.Add")}
        form={form}
        onSubmit={(values: LocalEngine) => {
          setEngines(async (prev) => [
            ...(await prev).filter((engine) => engine.type === "local"),
            values,
          ]);
          setOpened(false);
          form.reset();
          form.setFieldValue("id", crypto.randomUUID());
        }}
      />
    </Modal>
  );
}

export default AddEngine;
