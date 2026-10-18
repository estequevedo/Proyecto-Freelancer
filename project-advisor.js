(() => {
    const form = document.querySelector('#project-advisor-form');
    if (!form) return;

    const description = document.querySelector('#project-description');
    const goal = document.querySelector('#project-goal');
    const stage = document.querySelector('#project-stage');
    const button = form.querySelector('button[type="submit"]');
    const status = document.querySelector('#project-advisor-status');
    const errorMessage = document.querySelector('#project-advisor-error');
    const result = document.querySelector('#project-advisor-result');

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        errorMessage.textContent = '';
        result.textContent = '';
        result.hidden = true;
        status.textContent = 'Preparando recomendaciones para tu proyecto…';
        button.disabled = true;

        try {
            const response = await fetch('/api/project-recommendations', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    description: description.value.trim(),
                    goal: goal.value,
                    stage: stage.value
                })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || 'No se pudieron generar las recomendaciones. Probá de nuevo.');
            }

            result.textContent = data.recommendations;
            result.hidden = false;
            status.textContent = 'Orientación generada. Si querés avanzar, podés escribir desde la sección de contacto.';
        } catch (error) {
            status.textContent = '';
            errorMessage.textContent = error.message || 'No se pudo conectar con el servidor. Probá de nuevo.';
        } finally {
            button.disabled = false;
        }
    });
})();
