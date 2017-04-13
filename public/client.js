// client-side js
// run by the browser each time your view template is loaded

// by default, you've got jQuery,
// add other scripts at the bottom of index.html

$(function() {
  console.log('hello world :o');
  
  if (location.search === "?ok!") {
    // now auth'd
    
    $("[disabled]").removeAttr("disabled");

    $('form').submit(function (ev) {
      ev.preventDefault();
      var screen_name = $('input').val();
      $.post('/favs?' + $.param({ screen_name: screen_name }), function() {
        $('input').val('').focus();
      });
    });
  }

});
