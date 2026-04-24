(function () {
    const MOBILE_BREAKPOINT = 980;

    function closeNav(toggle) {
        document.body.classList.remove("nav-open");
        if (toggle) {
            toggle.setAttribute("aria-expanded", "false");
        }
    }

    function openNav(toggle) {
        document.body.classList.add("nav-open");
        if (toggle) {
            toggle.setAttribute("aria-expanded", "true");
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        const sidebar = document.querySelector(".sidebar");
        const toggle = document.querySelector("[data-mobile-nav-toggle]");
        const overlay = document.querySelector(".sidebar-overlay");

        if (!sidebar || !toggle || !overlay) {
            return;
        }

        toggle.addEventListener("click", () => {
            if (document.body.classList.contains("nav-open")) {
                closeNav(toggle);
                return;
            }
            openNav(toggle);
        });

        overlay.addEventListener("click", () => closeNav(toggle));

        sidebar.querySelectorAll("a").forEach((link) => {
            link.addEventListener("click", () => {
                if (window.innerWidth <= MOBILE_BREAKPOINT) {
                    closeNav(toggle);
                }
            });
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                closeNav(toggle);
            }
        });

        window.addEventListener("resize", () => {
            if (window.innerWidth > MOBILE_BREAKPOINT) {
                closeNav(toggle);
            }
        });
    });
})();
