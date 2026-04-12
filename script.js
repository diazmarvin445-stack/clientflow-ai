(function () {
  "use strict";

  var yearEl = document.getElementById("year");
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }

  // Mobile nav
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.querySelector(".nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  // Scroll reveal
  var revealEls = document.querySelectorAll(".reveal");
  if (revealEls.length && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { root: null, rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    revealEls.forEach(function (el) {
      io.observe(el);
    });
  } else {
    revealEls.forEach(function (el) {
      el.classList.add("is-visible");
    });
  }

  // File input label (solicitar.html uses solicitar.js for submit + file hint)
  var form = document.getElementById("request-form");
  var successEl = document.getElementById("success-message");
  var fileInput = form ? form.querySelector('input[name="photo"]') : null;
  var fileNameEl = document.getElementById("file-name");
  var onSolicitarPage =
    document.body && document.body.getAttribute("data-page") === "solicitar";

  if (fileInput && fileNameEl && !onSolicitarPage) {
    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      if (file) {
        fileNameEl.textContent = file.name;
        fileNameEl.hidden = false;
      } else {
        fileNameEl.textContent = "";
        fileNameEl.hidden = true;
      }
    });
  }

  if (form && successEl && !onSolicitarPage) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();

      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }

      form.classList.add("is-hidden");
      successEl.hidden = false;

      form.reset();
      if (fileNameEl) {
        fileNameEl.textContent = "";
        fileNameEl.hidden = true;
      }

      successEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }
})();
