let config = JSON.parse(localStorage.getItem('PageConfig')) || {
    wallpaper: './img/wp.jpg',
    weatherLat: '',
    weatherLon: '',
    categories: [
        { title: "/dev", color: "#48c774", links: [{ name: "Github", url: "https://github.com", icon: "fa-brands fa-github" }] },
        { title: "/social", color: "#3273dc", links: [{ name: "Reddit", url: "https://reddit.com", icon: "fa-brands fa-reddit-alien" }] }
    ]
};

function hexToRgba(hex, alpha = 0.7) {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
    const num = parseInt(hex, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r},${g},${b},${alpha})`;
}

function renderPage() {
    document.getElementById('body-bg').style.backgroundImage = `url('${config.wallpaper}')`;
    const grid = document.getElementById('link-grid');
    grid.innerHTML = '';

    config.categories.forEach(cat => {
        const col = document.createElement('div');
        col.className = 'column is-narrow'; // Keeps the box compact
        const headingBg = hexToRgba(cat.color, 0.4);
        col.innerHTML = `
            <nav class="panel">
                <p class="panel-heading has-text-centered" style="background-color: ${headingBg};">
                    ${cat.title}
                </p>
                ${cat.links.map(link => `
                    <a class="panel-block" href="${link.url}">
                        <span class="panel-icon"><i class="${link.icon || 'fas fa-link'}"></i></span>
                        ${link.name}
                    </a>
                `).join('')}
            </nav>
        `;
        grid.appendChild(col);
    });
    fetchWeather();
}

function updateTimeandDate() {
    document.getElementById('time-btn').textContent = moment().format('MMMM Do YYYY - h:mm:ss a');
}

async function fetchWeather() {
    if (!config.weatherLat || !config.weatherLon) {
        document.getElementById('weather-btn').textContent = "No coordinates";
        return;
    }
    try {
        const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${config.weatherLat}&lon=${config.weatherLon}`;
        const res = await fetch(url, {});
        const data = await res.json();
        const timeseries = data.properties.timeseries;
        // Find now, +3h, +6h
        const now = timeseries[0];
        const plus3h = timeseries.find(ts => {
            const diff = (new Date(ts.time) - new Date(now.time)) / (1000 * 60 * 60);
            return diff >= 3 - 0.5 && diff <= 3 + 0.5;
        });
        const plus6h = timeseries.find(ts => {
            const diff = (new Date(ts.time) - new Date(now.time)) / (1000 * 60 * 60);
            return diff >= 6 - 0.5 && diff <= 6 + 0.5;
        });

        function format(ts) {
            if (!ts) return "N/A";
            const details = ts.data.instant.details;
            let summary = `${Math.round(details.air_temperature)}°C`;
            if (details.feels_like_temperature !== undefined) {
                summary += ` (feels like ${Math.round(details.feels_like_temperature)}°C)`;
            }
            const next = ts.data.next_1_hours || ts.data.next_6_hours || ts.data.next_12_hours;
            if (next && next.summary && next.summary.symbol_code) {
                summary += `, ${next.summary.symbol_code.replace(/_/g, ' ')}`;
            }
            // Precipitation probability
            if (next && next.details && typeof next.details.probability_of_precipitation === "number") {
                summary += `, Rain: ${next.details.probability_of_precipitation}%`;
            }
            return summary;
        }

        const output = `Now: ${format(now)} | +3h: ${format(plus3h)} | +6h: ${format(plus6h)}`;
        document.getElementById('weather-btn').textContent = output;
    } catch (e) {
        document.getElementById('weather-btn').textContent = " ";
    }
}

// --- Editor Logic ---
function renderEditor() {
    const list = document.getElementById('menu-editor-list');
    list.innerHTML = '';
    document.getElementById('wallpaper-input').value = config.wallpaper;
    document.getElementById('lat-input').value = config.weatherLat || '';
    document.getElementById('lon-input').value = config.weatherLon || '';

    config.categories.forEach((cat, cIdx) => {
        const div = document.createElement('div');
        div.className = 'category-edit-box';
        div.innerHTML = `
            <div class="columns is-mobile is-gapless mb-2">
                <div class="column"><input class="input is-small" value="${cat.title}" onchange="config.categories[${cIdx}].title=this.value"></div>
                <div class="column is-narrow mx-1"><input type="color" value="${cat.color}" onchange="config.categories[${cIdx}].color=this.value"></div>
                <div class="column is-narrow"><button class="button is-danger is-small" onclick="config.categories.splice(${cIdx},1);renderEditor()">&times;</button></div>
            </div>
            <div id="links-${cIdx}"></div>
            <button class="button is-small is-fullwidth mt-1" onclick="config.categories[${cIdx}].links.push({name:'',url:'',icon:'fas fa-link'});renderEditor()">+ Link</button>
        `;
        cat.links.forEach((link, lIdx) => {
            const row = document.createElement('div');
            row.className = 'is-flex mb-1';
            row.innerHTML = `
                <input class="input is-small mr-1" placeholder="Name" value="${link.name}" onchange="config.categories[${cIdx}].links[${lIdx}].name=this.value">
                <input class="input is-small mr-1" placeholder="URL" value="${link.url}" onchange="config.categories[${cIdx}].links[${lIdx}].url=this.value">
                <input class="input is-small mr-1" placeholder="Icon" value="${link.icon}" onchange="config.categories[${cIdx}].links[${lIdx}].icon=this.value">
                <button class="button is-small" onclick="config.categories[${cIdx}].links.splice(${lIdx},1);renderEditor()">&times;</button>
            `;
            div.querySelector(`#links-${cIdx}`).appendChild(row);
        });
        list.appendChild(div);
    });
}

function init() {
    renderPage();
    setInterval(updateTimeandDate, 200);
    const mod = document.getElementById('config-modal');
    document.getElementById('config-btn').onclick = () => { renderEditor(); mod.classList.add('is-active'); };
    document.getElementById('close-btn').onclick = () => mod.classList.remove('is-active');
    document.getElementById('add-category-btn').onclick = () => { config.categories.push({title:'/new', color:'#3273dc', links:[]}); renderEditor(); };
    document.getElementById('save-btn').onclick = () => {
        config.wallpaper = document.getElementById('wallpaper-input').value;
        config.weatherLat = document.getElementById('lat-input').value;
        config.weatherLon = document.getElementById('lon-input').value;
        localStorage.setItem('PageConfig', JSON.stringify(config));
        renderPage();
        mod.classList.remove('is-active');
    };
}
init();