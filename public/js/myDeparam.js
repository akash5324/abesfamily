
(function($){
$.myDeparam = $.myDeparam || function(uri){
    if(uri === undefined){
      uri = window.location.pathname;
    }

    var value1 = window.location.pathname;
    var value2 = value1.split('/');
    var value3 = value2.pop();

    return value3;

};

$.myDeparam2 = $.myDeparam2 || function(uri){
    if(uri === undefined){
      uri = window.location.pathname;
    }

    var value1 = window.location.pathname;
    var value2 = value1.split('/');
    var value3 = value2.pop();
    var value4 = value2.pop();
    
    return value4;

};
})(jQuery);
