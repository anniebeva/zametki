export async function loadTemplates({
    templateSelect,
    templateStatus,
    setActionStatus,
}) {
    try {
        const response = await fetch("/api/templates");

        if (!response.ok) {
            throw new Error(`Ошибка загрузки шаблонов: ${response.status}`);
        }

        const data = await response.json();

        templateSelect.replaceChildren();

        if (data.templates.length === 0) {
            templateSelect.add(new Option("Нет доступных шаблонов", ""));
            setActionStatus(templateStatus, "Шаблоны не найдены");
            return;
        }

        templateSelect.add(new Option("Выберите шаблон", ""));

        for (const template of data.templates) {
            templateSelect.add(
                new Option(template.name, template.template_id),
            );
        }

        setActionStatus(templateStatus, "");
    } catch (error) {
        console.error("Не удалось загрузить шаблоны:", error);

        templateSelect.replaceChildren();
        templateSelect.add(new Option("Не удалось загрузить шаблоны", ""));

        setActionStatus(
            templateStatus,
            "Не удалось загрузить список шаблонов",
            "error",
        );
    }
}

export async function loadTemplateSchema(templateId) {
    const response = await fetch(
        `/api/templates/${encodeURIComponent(templateId)}`,
    );

    if (!response.ok) {
        throw new Error(`Ошибка загрузки схемы шаблона: ${response.status}`);
    }

    return response.json();
}

export function renderTemplateForm(schema, container) {
    const fragment = document.createDocumentFragment();

    for (const section of schema.sections) {
        const sectionElement = document.createElement("section");
        sectionElement.className = "form-section";

        const heading = document.createElement("h3");
        heading.textContent = section.title;
        sectionElement.append(heading);

        for (const field of section.fields) {
            const fieldElement = document.createElement("div");
            fieldElement.className = "form-field";

            const label = document.createElement("label");
            label.className = "field-label";
            label.textContent = field.label;
            label.htmlFor = `field-${field.id}`;

            let input;

            if (field.type === "textarea") {
                input = document.createElement("textarea");
            } else if (field.type === "select") {
                input = document.createElement("select");
                input.add(new Option("Выберите значение", ""));

                for (const option of field.options || []) {
                    input.add(new Option(option, option));
                }
            } else if (
                ["text", "number", "date", "time"].includes(field.type)
            ) {
                input = document.createElement("input");
                input.type = field.type;

                if (field.type === "number") {
                    input.step = "any";
                }
            } else {
                continue;
            }

            input.id = `field-${field.id}`;
            input.name = field.id;
            input.className = "field-control";

            fieldElement.append(label, input);

            if (field.unit) {
                const unit = document.createElement("span");
                unit.className = "field-unit";
                unit.textContent = field.unit;
                fieldElement.append(unit);
            }

            sectionElement.append(fieldElement);
        }

        fragment.append(sectionElement);
    }

    if (schema.static_text?.length) {
        const staticText = document.createElement("div");
        staticText.className = "form-static-text";

        for (const text of schema.static_text) {
            const paragraph = document.createElement("p");
            paragraph.textContent = text;
            staticText.append(paragraph);
        }

        fragment.append(staticText);
    }

    container.replaceChildren(fragment);
}