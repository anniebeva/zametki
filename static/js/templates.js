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