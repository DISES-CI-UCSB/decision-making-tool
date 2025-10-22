La herramienta Where to Work es una herramienta de apoyo a la toma de decisiones basada en la web para construir y resolver problemas de planificación sistemática de conservación. Para lograrlo, emplea técnicas de programación entera para formular problemas de optimización matemática y utiliza algoritmos exactos para encontrar resultados casi óptimos. Como consecuencia, la herramienta puede analizar rápidamente conjuntos de datos grandes y complejos y realizar análisis en tiempo real para ayudar a facilitar las discusiones entre las partes interesadas. Aunque esta herramienta puede ayudar a identificar soluciones optimizadas para problemas de conservación del mundo real, no sustituye la toma de decisiones de conservación. Dado que los resultados dependen de los datos de entrada, y dichos datos pueden omitir consideraciones importantes, la herramienta está destinada a ayudar a informar la toma de decisiones. Aquí proporcionamos una breve descripción general de la herramienta. Consulte el manual para obtener más detalles (<a href=www/WhereToWork_UserManual.pdf target="_blank">haga clic aquí para descargar</a>).

#### Datos

La herramienta utiliza datos espaciales para identificar prioridades de conservación. Estos datos pueden incluir temas, pesos, inclusiones y exclusiones. A continuación, describimos cada uno de estos diferentes tipos de datos.

**Temas:** Los temas describen aspectos de la biodiversidad que son importantes para la conservación (por ejemplo, especies, hábitats, ecosistemas). Para ayudar a proteger estos temas, puedes establecer metas que garanticen un nivel mínimo de cobertura por parte de las soluciones (también conocidas como objetivos en la terminología de la planificación sistemática de la conservación). Por ejemplo, establecer una meta del 20% asegura que el 20% de la extensión espacial total del tema esté cubierta por la solución. Algunos temas pueden contener múltiples componentes denominados características. Por ejemplo, un tema relacionado con especies amenazadas puede incluir características, donde cada característica corresponde a una especie diferente.

**Pesos:** Un peso describe las propiedades de los lugares que pueden dificultar o mejorar los esfuerzos de conservación. Establece el factor de peso entre –100 y 100 para indicar cuán importante es evitar o incluir (respectivamente) un determinado peso en la solución. Para evitar completamente un peso (por ejemplo, evitar todas las áreas con concesiones mineras), utiliza un valor de -100 (es decir, asegúrate de que las unidades de planificación con los valores más bajos posibles en el conjunto de datos de peso sean seleccionadas). Para incluir la mayor cantidad posible del peso (por ejemplo, incluir todas las áreas de importancia cultural), utiliza un valor de 100 (es decir, asegúrate de que las unidades de planificación con los valores más altos posibles en el conjunto de datos de peso sean seleccionadas). Establecer un valor de cero (desactivando el peso mediante el interruptor) significa que no se considera en absoluto en la priorización.

**Inclusiones:** Una inclusión se refiere a áreas que ya están gestionadas para la conservación. Al activar una inclusión, se garantiza que las soluciones seleccionen lugares que ya están gestionados para la conservación (similar a "bloquear" ciertos lugares en la terminología de planificación sistemática de la conservación). Esto es importante para que las soluciones se basen en la red de reservas existente. También puede ser útil generar soluciones que no consideren las reservas actuales, por ejemplo, para explorar escenarios contrafactuales y planes de manejo generados mediante otros procesos (por ejemplo, ¿qué pasaría si construyéramos un nuevo sistema desde cero?).

**Exclusiones:** Una exclusión se refiere a áreas que no son funcionales para la conservación. Al activar una exclusión, se garantiza que las soluciones no seleccionen sitios dentro de esas áreas (similar a "bloquear" ciertos lugares en la terminología de planificación sistemática de la conservación). Un ejemplo de exclusiones podrían ser las zonas de uso industrial o residencial.

#### Interfaz de Usuario

La herramienta tiene tres componentes principales que conforman la interfaz de usuario. Estos componentes incluyen: (i) botones en la parte superior del mapa, (ii) una barra lateral izquierda para visualizar y descargar datos, y (iii) una barra lateral derecha para generar y evaluar soluciones. A continuación, describimos cada uno de estos componentes.

**Botones del mapa:** Estos botones proporcionan la siguiente funcionalidad.

<ul class = "middle-icon">
<li><div><span class = "leaflet-touch"><span class = "leaflet-bar easy-button-container leaflet-control"><button class = "easy-button-button leaflet-bar-part"><icon class = "fa fa-xs fa-question"></button></span></span><p>Abre nuevamente esta ventana pop-up.</p></div></li>

<li><div><span class = "leaflet-touch"><span class = "leaflet-bar easy-button-container leaflet-control"><button class = "easy-button-button leaflet-bar-part"><icon class = "fa fa-xs fa-home"></button></span></span><p>Acerca o aleja el mapa para mostrar toda la extensión de los datos.</p></div></li>

<li><div><span class = "leaflet-touch"><span class = "history-control leaflet-bar leaflet-control horizontal"><a class = "history-back-button"><icon class = "fa fa-xs fa-caret-left"></a><a class = "history-forward-button"><icon class = "fa fa-xs fa-caret-right"></a></span></span><p>Cambia entre las extensiones espaciales anteriores en el mapa.</p></div></li>

<li><div><span class = "leaflet-touch"><span class = "leaflet-bar easy-button-container leaflet-control"><button class = "easy-button-button leaflet-interactive leaflet-bar-part hide-all-layers"><icon class = "fa fa-xs fa-eye-slash"></button></span></span><p>Oculta todos los datos sobre el mapa.</p></div></li>

<li><div><span class = "leaflet-touch"><span class = "leaflet-bar easy-button-container leaflet-control"><button class = "easy-button-button leaflet-interactive leaflet-bar-part"><icon class = "fa fa-xs fa-print"></button></span></span><p>Guarda el mapa como imagen.</p></div></li>

<li><div><span class = "leaflet-touch"><span class = "leaflet-bar easy-button-container leaflet-control"><button class = "easy-button-button leaflet-interactive leaflet-bar-part"><icon class = "fa fa-xs fa-globe"></button></span></span><p>Pasa el cursor sobre el botón para seleccionar un mapa base diferente.</p></div></li>

</ul>
</br>

**Barra lateral izquierda:** La barra lateral izquierda contiene principalmente paneles para visualizar los datos. También incluye paneles que proporcionan información de contacto del equipo de desarrollo y reconocimientos a las personas, organizaciones y programas que han contribuido a la herramienta. A continuación, describiremos cada uno de estos paneles. Para abrir uno de ellos, haz clic en el ícono correspondiente en la barra lateral.

<ul class = "middle-icon">
<li><div><span class = "leaflet-touch"><span class = "leaflet-bar easy-button-container leaflet-control"><button class = "easy-button-button leaflet-interactive leaflet-bar-part"><icon class = "fa fa-xs fa-layer-group"></button></span></span><p>El <em>panel de Tabla de contenido</em> se utiliza para visualizar interactivamente los datos en el mapa. Cada capa corresponde a un tema (<icon class = "fa fa-xs fa-star"></icon>), peso (<icon class = "fa fa-xs fa-weight-hanging"></icon>), inclusión (<icon class = "fa fa-xs fa-lock"></icon>), o exclusión (<icon class = "fa fa-xs fa-ban"></icon>) (según lo indicado por los íconos). Estas capas se pueden ordenar arrastrar y soltar. También, pueden mostrarse u ocultarse (utilizando los botones <icon class = "fa fa-xs fa-eye"></icon>/<icon class = "fa fa-xs fa-eye-slash" style="color:red"></icon>).</p></div></li>
<li><div><span class = "leaflet-touch"><span class = "leaflet-bar easy-button-container leaflet-control"><button class = "easy-button-button leaflet-interactive leaflet-bar-part"><icon class = "fa fa-xs fa-download"></button></span></span><p>El <em>panel de Descargas</em> puede utilizarse para descargar datos y resultados. En concreto, los conjuntos de datos espacialmente explícitos de los temas, pesos e inclusiones pueden descargarse (por ejemplo, en formato ráster o vectorial). Además, también pueden descargarse las soluciones, junto con estadísticas que resumen su rendimiento.</p></div></li>
<li><div><span class = "leaflet-touch"><span class = "leaflet-bar easy-button-container leaflet-control"><button class = "easy-button-button leaflet-interactive leaflet-bar-part"><icon class = "fa fa-xs fa-envelope"></button></span></span><p>El <em>panel de Contacto</em> proporciona información para comunicarse con el equipo de desarrollo.</p></div></li>
<li><div><span class = "leaflet-touch"><span class = "leaflet-bar easy-button-container leaflet-control"><button class = "easy-button-button leaflet-interactive leaflet-bar-part"><icon class = "fa fa-xs fa-heart"></button></span></span><p>El <em>panel de Agradecimientos</em> detalla todas las contribuciones y el apoyo brindado por diversas personas y organizaciones. Además, este panel describe todo el software de código abierto que sustenta la herramienta.</p></div></li>

</ul>
</br>


**Barra lateral derecha:** La barra lateral derecha contiene paneles para cargar soluciones existentes y evaluarlas. Para abrir este panel, haz clic en el ícono correspondiente en la barra lateral.

<ul>
<li><div><span class = "leaflet-touch"><span class = "leaflet-bar easy-button-container leaflet-control"><button class = "easy-button-button leaflet-interactive leaflet-bar-part"><icon class = "fa fa-xs fa-tachometer-alt"></button></span></span><p>El <em>panel de Soluciones</em> se utiliza para cargar y evaluar las soluciones. En la sección <em>Cargar Solución</em>, puedes seleccionar una solución de la base de datos, elegir un color para su visualización y hacer clic en el botón "Cargar" para cargarla en el mapa. Una vez cargada, la solución aparecerá en el <em>panel de Tabla de contenido</em>. En la sección <em>Ver Resultados</em>, puedes evaluar las soluciones cargadas. Proporciona estadísticas que resumen diversas características de la solución (en el panel <em>Resumen</em>), como el área total abarcada por la solución y el número de reservas individuales dentro de ella. También ofrece gráficos circulares para visualizar cuánto representa la solución de cada uno de los temas (en el panel <em>Temas</em>), pesos (en el panel <em>Pesos</em>) e inclusiones (en el panel <em>Inclusiones</em>). Estos gráficos circulares muestran la cantidad de cobertura por las inclusiones seleccionadas (mostradas en verde), así como por la solución (mostrada en el color elegido para visualizarla). Además de los gráficos circulares, esta información puede visualizarse en forma tabular (es decir, haciendo clic en el botón de tabla).</p></div></li>

</ul>
</br>
